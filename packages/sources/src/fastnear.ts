import type { ChainAction, ChainTx, Network, Transfer } from "@gideon/core";
import { NETWORKS } from "@gideon/core";
import { json, request, SourceError, type HttpOptions } from "./http.js";

/**
 * FastNEAR's transactions API (free, no key). It follows the chain head, so a send made a minute
 * ago is already there, while NearBlocks' free testnet index can lag weeks behind.
 * Two steps: the account's newest transaction hashes, then those transactions (20 per request).
 */
export class FastNearTx {
  constructor(private o: HttpOptions = {}) {}

  private async post<T>(network: Network, path: string, body: unknown): Promise<T> {
    const url = `${NETWORKS[network].txApi}${path}`;
    const res = await request(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) }, this.o);
    if (res.status === 429) throw new SourceError("FastNEAR rate limit reached");
    if (!res.ok) throw new SourceError(`FastNEAR HTTP ${res.status}`);
    return json<T>(res, url);
  }

  /** Transactions by hash, in the order of `rows` (newest first), with the indexer's block height. */
  private async txs(network: Network, rows: { transaction_hash?: string; tx_block_height?: number }[]): Promise<ChainTx[]> {
    const height = new Map(rows.filter((r) => r.transaction_hash && r.tx_block_height != null).map((r) => [r.transaction_hash!, Number(r.tx_block_height)]));
    const hashes = [...new Set(rows.flatMap((r) => (r.transaction_hash ? [r.transaction_hash] : [])))];
    const batches: string[][] = [];
    for (let i = 0; i < hashes.length; i += 20) batches.push(hashes.slice(i, i + 20));
    const got = await Promise.all(batches.map((b) => this.post<{ transactions?: any[] }>(network, "/v0/transactions", { tx_hashes: b })));
    const byHash = new Map<string, ChainTx>();
    for (const g of got) for (const t of g.transactions ?? []) {
      const x = chainTx(t, height);
      if (x) byHash.set(x.hash, x);
    }
    return hashes.map((h) => byHash.get(h)).filter((x): x is ChainTx => !!x);
  }

  /** The account's newest transactions where it really received something, and how many it has. */
  async inboundTxs(network: Network, accountId: string, limit: number): Promise<{ total: number; txs: ChainTx[] }> {
    type Row = { transaction_hash?: string; tx_block_height?: number };
    const a = await this.post<{ account_txs?: Row[]; txs_count?: number }>(network, "/v0/account", { account_id: accountId, is_real_receiver: true, limit: Math.min(limit, 200) });
    const rows = a.account_txs ?? [];
    return { total: Number(a.txs_count ?? rows.length), txs: await this.txs(network, rows) };
  }

  /** T2: how many transactions the account has in total (as signer or receiver). */
  async txCount(network: Network, accountId: string): Promise<number> {
    const a = await this.post<{ txs_count?: number }>(network, "/v0/account", { account_id: accountId, limit: 1 });
    if (typeof a.txs_count !== "number") throw new SourceError("FastNEAR gave no transaction count");
    return a.txs_count;
  }

  /** Transactions the account signed at or before `blockHeight`, newest first. */
  async signedTxsUpTo(network: Network, accountId: string, blockHeight: number, limit: number): Promise<ChainTx[]> {
    type Row = { transaction_hash?: string; tx_block_height?: number };
    const a = await this.post<{ account_txs?: Row[] }>(network, "/v0/account", { account_id: accountId, is_real_signer: true, to_tx_block_height: blockHeight, limit: Math.min(limit, 200) });
    return this.txs(network, a.account_txs ?? []);
  }

  /** Account health: the newest transactions the account signed, newest first. */
  async signedTxs(network: Network, accountId: string, limit: number): Promise<ChainTx[]> {
    type Row = { transaction_hash?: string; tx_block_height?: number };
    const a = await this.post<{ account_txs?: Row[] }>(network, "/v0/account", { account_id: accountId, is_real_signer: true, limit: Math.min(limit, 200) });
    return this.txs(network, a.account_txs ?? []);
  }

  /** Account health: these transactions (any order), with signing key and actions. */
  async txsByHash(network: Network, hashes: string[]): Promise<ChainTx[]> {
    return this.txs(network, [...new Set(hashes)].map((h) => ({ transaction_hash: h })));
  }

  /** The newest transactions: up to 20 the account signed, plus up to 20 of any kind (incoming, dust). */
  async recentTransfers(network: Network, accountId: string): Promise<Transfer[]> {
    type Row = { transaction_hash?: string };
    const [signed, all] = await Promise.all([
      this.post<{ account_txs?: Row[] }>(network, "/v0/account", { account_id: accountId, is_real_signer: true, limit: 20 }),
      this.post<{ account_txs?: Row[] }>(network, "/v0/account", { account_id: accountId, limit: 20 }),
    ]);
    const hashes = [...new Set([...(signed.account_txs ?? []), ...(all.account_txs ?? [])].map((r) => r.transaction_hash).filter((h): h is string => !!h))];
    if (!hashes.length) return [];
    const batches: string[][] = [];
    for (let i = 0; i < hashes.length; i += 20) batches.push(hashes.slice(i, i + 20));
    const got = await Promise.all(batches.map((b) => this.post<{ transactions?: any[] }>(network, "/v0/transactions", { tx_hashes: b })));
    const out: Transfer[] = [];
    for (const g of got) for (const t of g.transactions ?? []) {
      const tx = t?.transaction;
      if (!tx?.signer_id || !tx?.receiver_id) continue;
      let deposit = 0;
      for (const a of tx.actions ?? []) deposit += Number(a?.Transfer?.deposit ?? a?.FunctionCall?.deposit ?? 0) || 0;
      const ts = t?.execution_outcome?.block_timestamp;
      out.push({ hash: tx.hash, signer: tx.signer_id, receiver: tx.receiver_id, depositYocto: deposit, ...(ts ? { blockTimestampNs: String(ts) } : {}) });
    }
    return out.sort((a, b) => Number(b.blockTimestampNs ?? 0) - Number(a.blockTimestampNs ?? 0));
  }
}

/**
 * Both histories, merged: the fresh one `a` (FastNEAR) and the deeper one `b` (NearBlocks).
 * When FastNEAR answers first, NearBlocks gets `graceMs` more. When NearBlocks answers first,
 * FastNEAR gets `freshGraceMs` more, since it's the one with sends from the last few weeks.
 * An empty answer never starts the clock (a lagging index often has nothing yet), so the other
 * source is waited for. Whatever settled by then is used. Fails only if both fail.
 */
export function mergedHistory(a: () => Promise<Transfer[]>, b: () => Promise<Transfer[]>, graceMs = 700, freshGraceMs = 2500): Promise<Transfer[]> {
  return new Promise((resolve, reject) => {
    const res: (Transfer[] | null)[] = [null, null];
    const errs: unknown[] = [];
    let settled = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      const ok = res.filter((r): r is Transfer[] => !!r);
      if (!ok.length) return reject(errs[0] ?? new SourceError("no history source answered"));
      const seen = new Set<string>();
      const merged: Transfer[] = [];
      for (const t of ok.flat()) if (!seen.has(t.hash)) { seen.add(t.hash); merged.push(t); }
      resolve(merged.sort((x, y) => Number(y.blockTimestampNs ?? 0) - Number(x.blockTimestampNs ?? 0)));
    };
    [a, b].forEach((fn, i) => {
      fn().then((v) => { res[i] = v; }, (e) => { errs.push(e); }).finally(() => {
        settled++;
        if (settled === 2) return finish();
        if (res[i]?.length && !timer) timer = setTimeout(finish, i === 0 ? graceMs : freshGraceMs);
      });
    });
  });
}

/** One FastNEAR /v0/transactions entry → ChainTx (null when it's missing what R18 needs). */
export function chainTx(t: any, height: Map<string, number> = new Map()): ChainTx | null {
  const tx = t?.transaction;
  if (!tx?.hash || !tx?.signer_id || !tx?.receiver_id || !tx?.public_key) return null;
  const actions: ChainAction[] = (Array.isArray(tx.actions) ? tx.actions : []).map((a: any): ChainAction => {
    if (a?.Transfer) return { kind: "transfer", depositYocto: String(a.Transfer.deposit ?? "0") };
    if (a?.AddKey) return { kind: "addKey", publicKey: String(a.AddKey.public_key ?? ""), fullAccess: a.AddKey.access_key?.permission === "FullAccess" };
    if (a?.DeleteKey) return { kind: "deleteKey", publicKey: String(a.DeleteKey.public_key ?? "") };
    return { kind: "other" };
  });
  const ts = Number(t?.execution_outcome?.block_timestamp ?? 0);
  return {
    hash: tx.hash, signer: tx.signer_id, signerKey: tx.public_key, receiver: tx.receiver_id,
    timestampMs: Math.floor(ts / 1e6), blockHeight: height.get(tx.hash) ?? Number(t?.execution_outcome?.block_height ?? 0), actions,
  };
}
