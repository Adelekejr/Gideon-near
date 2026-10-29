import type { CheckInput, Classification, Asset, Destination, Sources, SourceCall } from "./types.js";

export type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

export interface Ctx {
  input: CheckInput & { asset: Asset; destination: Destination };
  c: Classification;
  /** Calls a source once per key, records timing, never throws. */
  ask<T>(source: string, key: string, fn: (s: Sources) => Promise<T>): Promise<Settled<T>>;
  calls: SourceCall[];
  /** Clock (ms since epoch) for deadline checks. */
  now: number;
  /** Flag registry contract for R10, or null when none is configured. */
  registry: string | null;
}

export function makeCtx(input: Ctx["input"], c: Classification, sources: Sources, now = Date.now(), registry: string | null = null): Ctx {
  const memo = new Map<string, Promise<Settled<unknown>>>();
  const calls: SourceCall[] = [];
  return {
    input,
    c,
    calls,
    now,
    registry,
    ask<T>(source: string, key: string, fn: (s: Sources) => Promise<T>) {
      const k = `${source}:${key}`;
      if (!memo.has(k)) {
        const t0 = Date.now();
        memo.set(
          k,
          fn(sources).then(
            (value) => { calls.push({ source: k, ok: true, ms: Date.now() - t0 }); return { ok: true as const, value }; },
            (e: unknown) => {
              const error = e instanceof Error ? e.message : String(e);
              calls.push({ source: k, ok: false, ms: Date.now() - t0, error });
              return { ok: false as const, error };
            },
          ),
        );
      }
      return memo.get(k) as Promise<Settled<T>>;
    },
  };
}

export function yoctoToNear(yocto: string | number): string {
  const n = typeof yocto === "number" ? yocto / 1e24 : Number(BigInt(yocto) / 10n ** 18n) / 1e6;
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}
