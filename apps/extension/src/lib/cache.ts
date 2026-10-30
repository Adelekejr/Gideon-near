import type { Sources } from "@gideon/core";

/**
 * Short-lived memory for one service worker. Account lookups are shared between the network
 * guess (both networks), the check itself and repeat checks of the same address, and two
 * identical requests in flight share one fetch. Failures are never kept.
 */
export class TtlCache<T> {
  private map = new Map<string, { at: number; value: Promise<T> }>();
  constructor(private ttlMs: number, private now: () => number = Date.now, private max = 200) {}

  get(key: string): Promise<T> | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.at > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  /** Return the cached promise for `key`, or start `make()` and cache it (dropped again if it fails). */
  wrap(key: string, make: () => Promise<T>, keep: (v: T) => boolean = () => true): Promise<T> {
    const hit = this.get(key);
    if (hit) return hit;
    const value = make();
    this.set(key, value);
    value.then((v) => { if (!keep(v) && this.map.get(key)?.value === value) this.map.delete(key); },
      () => { if (this.map.get(key)?.value === value) this.map.delete(key); });
    return value;
  }

  set(key: string, value: Promise<T>): void {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string);
    this.map.set(key, { at: this.now(), value });
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }
}

/** Sources with account lookups (existence, creation date, archival dating) remembered for `ttlMs`. */
export function cachedSources(s: Sources, ttlMs = 3 * 60_000, now: () => number = Date.now, historyTtlMs = 60_000): Sources {
  const accounts = new TtlCache<Awaited<ReturnType<Sources["viewAccount"]>>>(ttlMs, now);
  // Your own history changes when you send, so it's kept only briefly. Failures are never kept.
  const history = new TtlCache<Awaited<ReturnType<Sources["recentTransfers"]>>>(historyTtlMs, now);
  const sent = new TtlCache<number>(historyTtlMs, now);
  const created = new TtlCache<unknown>(ttlMs, now);
  const existed = new TtlCache<boolean | null>(ttlMs, now);
  return {
    ...s,
    // "Not found" isn't kept: the account may be created a minute later.
    viewAccount: (n, a) => accounts.wrap(`${n}:${a}`, () => s.viewAccount(n, a), (v) => v != null),
    recentTransfers: (n, a) => history.wrap(`${n}:${a}`, () => s.recentTransfers(n, a)),
    // A send makes "never sent here" stale, so only "sent before" (which can't change back) is kept.
    ...(s.sentCount ? { sentCount: (n, f, t) => sent.wrap(`${n}:${f}>${t}`, () => s.sentCount!(n, f, t), (v) => v > 0) } : {}),
    // Dates and dateless-but-indexed answers are kept (see hasDate).
    ...(s.accountCreated
      ? { accountCreated: (n, a) => created.wrap(`${n}:${a}`, () => s.accountCreated!(n, a), hasDate) as ReturnType<NonNullable<Sources["accountCreated"]>> }
      : {}),
    // Never changes either way, so both answers are kept.
    ...(s.accountAtGenesis
      ? { accountAtGenesis: (n, a) => existed.wrap(`${n}:${a}:genesis`, () => s.accountAtGenesis!(n, a)) }
      : {}),
    ...(s.accountExistedAt
      ? { accountExistedAt: (n, a, t) => existed.wrap(`${n}:${a}:${Math.round(t / 3_600_000)}`, () => s.accountExistedAt!(n, a, t)) }
      : {}),
  };
}

/**
 * Keep an answer that can't change: a date, or "the indexer knows this account but it has no
 * creation transaction" (accounts from NEAR's launch, dated by the genesis read). "Not indexed
 * yet" changes as the indexer catches up, so it's asked again.
 */
function hasDate(v: unknown): boolean {
  if (typeof v === "number") return v > 0;
  if (!v || typeof v !== "object") return false;
  const o = v as { createdMs?: unknown; indexed?: unknown };
  return !!o.createdMs || o.indexed === true;
}
