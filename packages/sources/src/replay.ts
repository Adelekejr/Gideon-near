import type { Sources } from "@gideon/core";

/** One recorded answer from a live source. */
export type Recorded = { value: unknown } | { error: string };
export type Recording = Record<string, Recorded>;

const METHODS = ["viewAccount", "tronTx", "ethTx", "btcTx", "ftMetadata", "storageRegistered", "oneClickStatus", "recentTransfers", "nearTx", "communityFlags", "accountCreated", "accountExistedAt", "accountAtGenesis", "sentCount"] as const;
/** Info-only methods: a missing recording means "unknown" (null), not a failure. */
const INFO_ONLY = new Set<string>(["accountCreated", "accountExistedAt", "accountAtGenesis"]);

export const recordKey = (method: string, args: unknown[]) => `${method}(${args.map((a) => JSON.stringify(a)).join(",")})`;

/** Wrap live sources and remember every answer, to save as an offline fixture. */
export function recordingSources(inner: Sources, into: Recording, scrub: (method: string, value: unknown) => unknown = (_m, v) => v): Sources {
  const out = {} as Record<string, unknown>;
  for (const m of METHODS) {
    if (typeof inner[m] !== "function") continue;
    out[m] = async (...args: unknown[]) => {
      const k = recordKey(m, args);
      try {
        const v = await (inner[m] as (...a: unknown[]) => Promise<unknown>)(...args);
        into[k] = { value: scrub(m, v) };
        return v;
      } catch (e) {
        into[k] = { error: e instanceof Error ? e.message : String(e) };
        throw e;
      }
    };
  }
  return out as unknown as Sources;
}

/** Answer only from a recording. Anything not recorded fails, which the engine reports as "couldn't check". */
export function replaySources(rec: Recording): Sources {
  const out = {} as Record<string, unknown>;
  for (const m of METHODS) {
    out[m] = async (...args: unknown[]) => {
      const r = rec[recordKey(m, args)];
      if (!r) {
        if (INFO_ONLY.has(m)) return null;
        throw new Error(`offline: no recorded answer for ${m}`);
      }
      if ("error" in r) throw new Error(r.error);
      return r.value;
    };
  }
  return out as unknown as Sources;
}
