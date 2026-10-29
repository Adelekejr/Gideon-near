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
export function cachedSources(s: Sources, ttlMs = 3 * 60_000, now: () => number = Date.now): Sources {
  const accounts = new TtlCache<Awaited<ReturnType<Sources["viewAccount"]>>>(ttlMs, now);
  const created = new TtlCache<unknown>(ttlMs, now);
  const existed = new TtlCache<boolean | null>(ttlMs, now);
  return {
    ...s,
    // "Not found" isn't kept: the account may be created a minute later.
    viewAccount: (n, a) => accounts.wrap(`${n}:${a}`, () => s.viewAccount(n, a), (v) => v != null),
    ...(s.accountCreated
      ? { accountCreated: (n, a) => created.wrap(`${n}:${a}`, () => s.accountCreated!(n, a), hasDate) as ReturnType<NonNullable<Sources["accountCreated"]>> }
      : {}),
    ...(s.accountExistedAt
      ? { accountExistedAt: (n, a, t) => existed.wrap(`${n}:${a}:${Math.round(t / 3_600_000)}`, () => s.accountExistedAt!(n, a, t)) }
      : {}),
  };
}

function hasDate(v: unknown): boolean {
  return typeof v === "number" ? v > 0 : !!(v && typeof v === "object" && (v as { createdMs?: unknown }).createdMs);
}
