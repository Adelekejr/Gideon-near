import { movesFromNearBlocks, type AccountCreation, type AccountMove, type KeyRecord, type NearTx, type Network, type Transfer } from "@gideon/core";
import { NETWORKS } from "@gideon/core";
import { json, request, SourceError, type HttpOptions } from "./http.js";

type Meta = { next_page?: string | null; prev_page?: string | null };

/** NearBlocks public API v3 (no key, about 6 calls/minute). Testnet retired v1 on 2026-11-05; mainnet v1 goes away 22 Nov 2026. */
export class NearBlocks {
  /** Creation lookups, cached: a known date never changes; "no record yet" is re-asked after a minute. */
  private created = new Map<string, { at: number; value: Promise<AccountCreation> }>();
  constructor(private o: HttpOptions = {}) {}

  private async get<T>(network: Network, path: string): Promise<{ status: number; body: T | null; meta?: Meta }> {
    const url = `${NETWORKS[network].nearblocksApi}${path}`;
    const res = await request(url, { headers: { accept: "application/json" } }, this.o);
    if (res.status === 404) return { status: 404, body: null };
    if (res.status === 429) throw new SourceError("NearBlocks rate limit reached");
    if (!res.ok) throw new SourceError(`NearBlocks HTTP ${res.status}`);
    const raw = await json<{ data?: T; errors?: { message?: string }[]; meta?: Meta }>(res, url);
    if (raw && typeof raw === "object" && "data" in raw) {
      const err = raw.errors?.[0]?.message;
      if (err && (raw.data === null || raw.data === undefined)) throw new SourceError(`NearBlocks: ${err}`);
      return { status: res.status, body: (raw.data ?? null) as T | null, ...(raw.meta ? { meta: raw.meta } : {}) };
    }
    throw new SourceError("NearBlocks returned an unexpected reply");
  }

  /** Same rows as recentTransfers, with token amounts when the actions include them. */
  async accountActivity(network: Network, accountId: string): Promise<AccountMove[]> {
    const { body } = await this.get<unknown[]>(network, `/v3/accounts/${encodeURIComponent(accountId)}/txns?limit=25`);
    return movesFromNearBlocks(accountId, Array.isArray(body) ? body : []);
  }

  async recentTransfers(network: Network, accountId: string): Promise<Transfer[]> {
    const { body } = await this.get<Record<string, unknown>[]>(network, `/v3/accounts/${encodeURIComponent(accountId)}/txns?limit=25`);
    return (Array.isArray(body) ? body : []).map((t) => ({
      hash: String(t.transaction_hash ?? ""),
      signer: String(t.signer_account_id ?? t.predecessor_account_id ?? ""),
      receiver: String(t.receiver_account_id ?? ""),
      depositYocto: Number((t.actions_agg as { deposit?: unknown } | undefined)?.deposit ?? 0),
      blockTimestampNs: t.block_timestamp as Transfer["blockTimestampNs"],
    }));
  }

  /**
   * How many transactions `from` signed with `to` as the receiver. v3 count endpoints are
   * internal-only, so this reads the filtered tx list (up to 100). Enough for first-send (0 vs not).
   */
  async sentCount(network: Network, from: string, to: string): Promise<number> {
    const path = `/v3/accounts/${encodeURIComponent(from)}/txns?receiver=${encodeURIComponent(to)}&limit=100`;
    const { body } = await this.get<unknown[]>(network, path);
    if (!Array.isArray(body)) throw new SourceError("NearBlocks returned no count");
    return body.length;
  }

  /**
   * When an account was created, plus whether NearBlocks has indexed it at all.
   * v3 no longer returns a stub row with the indexer's last block for unknown accounts.
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
    type Created = { block_timestamp?: number | string | null };
    type Row = { account_id?: string; created?: Created | null };
    const { body } = await this.get<Row>(network, `/v3/accounts/${encodeURIComponent(accountId)}`);
    if (!body?.account_id) return { createdMs: null, indexed: false, indexedHeight: null };
    const ms = nsToMs(body.created?.block_timestamp);
    if (ms != null) return { createdMs: ms, indexed: true, indexedHeight: null };
    // Some older accounts have an empty `created` object on /accounts; first activity day still dates them.
    const firstDay = await this.firstActivityDay(network, accountId);
    return { createdMs: firstDay, indexed: true, indexedHeight: null };
  }

  private async firstActivityDay(network: Network, accountId: string): Promise<number | null> {
    try {
      const { body } = await this.get<{ first_day?: string | null }>(network, `/v3/accounts/${encodeURIComponent(accountId)}/stats`);
      const day = body?.first_day?.trim();
      if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
      const ms = Date.parse(`${day}T00:00:00Z`);
      return Number.isFinite(ms) && ms > 0 ? ms : null;
    } catch {
      // Account was indexed; a failed stats lookup must not wipe that. Callers may still try genesis.
      return null;
    }
  }

  /** Account health: the account's keys (current and removed), newest first, with the add and remove transactions. */
  async accountKeys(network: Network, accountId: string): Promise<KeyRecord[]> {
    type Stamp = { transaction_hash?: string | null; block_timestamp?: number | string | null; block?: { block_timestamp?: number | string | null } };
    type Row = { public_key?: string; permission_kind?: string; action_timestamp?: number | string | null; created?: Stamp | null; deleted?: Stamp | null };
    const { body } = await this.get<Row[]>(network, `/v3/accounts/${encodeURIComponent(accountId)}/keys?limit=50`);
    const when = (s: Stamp | null | undefined, fallback?: number | string | null) =>
      nsToMs(s?.block?.block_timestamp ?? s?.block_timestamp ?? fallback);
    return (Array.isArray(body) ? body : []).filter((k) => k.public_key).map((k) => ({
      publicKey: String(k.public_key),
      fullAccess: k.permission_kind === "FULL_ACCESS",
      createdTx: k.created?.transaction_hash ?? null,
      createdMs: when(k.created, k.action_timestamp),
      deletedTx: k.deleted?.transaction_hash ?? null,
      deletedMs: when(k.deleted),
    }));
  }

  async nearTx(network: Network, hash: string): Promise<NearTx | null> {
    const { body } = await this.get<Record<string, unknown>>(network, `/v3/txns/${encodeURIComponent(hash)}`);
    if (!body || typeof body !== "object") return null;
    const hashId = body.transaction_hash;
    if (hashId == null) return null;
    return {
      hash: String(hashId),
      signer: String(body.signer_account_id ?? ""),
      receiver: String(body.receiver_account_id ?? ""),
      blockTimestampNs: body.block_timestamp as NearTx["blockTimestampNs"],
    };
  }
}

/** NearBlocks timestamps are nanoseconds since epoch (string or number). */
function nsToMs(ns: number | string | null | undefined): number | null {
  if (ns == null || ns === "") return null;
  const ms = Math.round(Number(ns) / 1e6);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}
