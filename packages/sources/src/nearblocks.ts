import { movesFromNearBlocks, type AccountCreation, type AccountMove, type KeyRecord, type NearTx, type Network, type Transfer } from "@gideon/core";
import { NETWORKS } from "@gideon/core";
import { json, request, SourceError, type HttpOptions } from "./http.js";

/** NearBlocks free API (no key, about 6 calls/minute). */
export class NearBlocks {
  /** Creation lookups, cached: a known date never changes; "no record yet" is re-asked after a minute. */
  private created = new Map<string, { at: number; value: Promise<AccountCreation> }>();
  constructor(private o: HttpOptions = {}) {}

  private async get<T>(network: Network, path: string): Promise<{ status: number; body: T | null }> {
    const url = `${NETWORKS[network].nearblocksApi}${path}`;
    const res = await request(url, { headers: { accept: "application/json" } }, this.o);
    if (res.status === 404) return { status: 404, body: null };
    if (res.status === 429) throw new SourceError("NearBlocks rate limit reached");
    if (!res.ok) throw new SourceError(`NearBlocks HTTP ${res.status}`);
    return { status: res.status, body: await json<T>(res, url) };
  }

  /** Same rows as recentTransfers, with token amounts when the actions include them. */
  async accountActivity(network: Network, accountId: string): Promise<AccountMove[]> {
    const { body } = await this.get<{ txns?: unknown[] }>(network, `/v1/account/${encodeURIComponent(accountId)}/txns-only?per_page=25&order=desc`);
    return movesFromNearBlocks(accountId, body?.txns ?? []);
  }

  async recentTransfers(network: Network, accountId: string): Promise<Transfer[]> {
    const { body } = await this.get<{ txns?: any[] }>(network, `/v1/account/${encodeURIComponent(accountId)}/txns-only?per_page=25&order=desc`);
    return (body?.txns ?? []).map((t) => ({
      hash: t.transaction_hash,
      signer: t.signer_account_id ?? t.predecessor_account_id,
      receiver: t.receiver_account_id,
      depositYocto: Number(t.actions_agg?.deposit ?? 0),
      blockTimestampNs: t.block_timestamp,
    }));
  }

  /**
   * How many transactions `from` signed with `to` as the receiver, all time (NearBlocks count
   * endpoint; one small request). Token transfers aren't counted: their receiver is the token contract.
   */
  async sentCount(network: Network, from: string, to: string): Promise<number> {
    const { body } = await this.get<{ txns?: { count?: string | number }[] }>(network,
      `/v1/account/${encodeURIComponent(from)}/txns-only/count?to=${encodeURIComponent(to)}`);
    const n = Number(body?.txns?.[0]?.count);
    if (!Number.isFinite(n) || n < 0) throw new SourceError("NearBlocks returned no count");
    return n;
  }

  /**
   * When an account was created, plus whether NearBlocks has indexed it at all and how far its
   * data goes (its `block_height`), so the engine can tell "too new for the indexer" from "unknown".
   */
  async accountCreated(network: Network, accountId: string): Promise<AccountCreation> {
    const key = `${network}:${accountId}`;
    const hit = this.created.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.value;
    const value = this.readCreated(network, accountId);
    this.created.set(key, { at: Date.now(), value });
    value.then((v) => { if (v.createdMs) this.created.set(key, { at: Infinity, value }); },
      () => this.created.delete(key)); // never cache a failure
    return value;
  }

  private async readCreated(network: Network, accountId: string): Promise<AccountCreation> {
    type Row = { account_id?: string; created?: { block_timestamp?: number | string | null } | null; block_height?: string | number };
    const { body } = await this.get<{ account?: Row[] }>(network, `/v1/account/${encodeURIComponent(accountId)}`);
    const row = body?.account?.[0];
    const height = Number(row?.block_height);
    const indexedHeight = Number.isFinite(height) && height > 0 ? height : null;
    const ns = row?.created?.block_timestamp;
    const ms = ns == null ? NaN : Math.round(Number(ns) / 1e6);
    return { createdMs: Number.isFinite(ms) && ms > 0 ? ms : null, indexed: !!row?.account_id, indexedHeight };
  }

  /** Account health: the account's keys (current and removed), newest first, with the add and remove transactions. */
  async accountKeys(network: Network, accountId: string): Promise<KeyRecord[]> {
    type Row = { public_key?: string; permission_kind?: string; created?: { transaction_hash?: string | null; block_timestamp?: number | string | null }; deleted?: { transaction_hash?: string | null; block_timestamp?: number | string | null } };
    const { body } = await this.get<{ keys?: Row[] }>(network, `/v1/account/${encodeURIComponent(accountId)}/keys?page=1&per_page=50&order=desc`);
    const ms = (t: number | string | null | undefined) => (t == null || t === "" ? null : Math.floor(Number(t) / 1e6) || null);
    return (body?.keys ?? []).filter((k) => k.public_key).map((k) => ({
      publicKey: String(k.public_key),
      fullAccess: k.permission_kind === "FULL_ACCESS",
      createdTx: k.created?.transaction_hash ?? null,
      createdMs: ms(k.created?.block_timestamp),
      deletedTx: k.deleted?.transaction_hash ?? null,
      deletedMs: ms(k.deleted?.block_timestamp),
    }));
  }

  async nearTx(network: Network, hash: string): Promise<NearTx | null> {
    const { body } = await this.get<{ txns?: any[] }>(network, `/v1/txns/${encodeURIComponent(hash)}`);
    const t = body?.txns?.[0];
    if (!t) return null;
    return { hash: t.transaction_hash, signer: t.signer_account_id, receiver: t.receiver_account_id, blockTimestampNs: t.block_timestamp };
  }
}
