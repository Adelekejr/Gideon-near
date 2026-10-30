import type { Network, Transfer } from "@gideon/core";
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
