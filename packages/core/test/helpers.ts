import type { AccountInfo, CheckInput, Sources } from "../src/types.js";
import { check } from "../src/engine.js";

export const NOW = Date.parse("2026-10-29T12:00:00Z");
export const acct = (near = 5, codeHash = "11111111111111111111111111111111"): AccountInfo =>
  ({ amountYocto: (BigInt(Math.round(near * 1000)) * 10n ** 21n).toString(), codeHash, storageUsage: 182 });

const down = async (): Promise<never> => { throw new Error("source down"); };

/** Sources where every lookup fails unless overridden. Failing is the safe default for tests. */
export function fake(over: Partial<Sources> = {}): Sources {
  return {
    viewAccount: down, tronTx: down, ethTx: down, btcTx: down, ftMetadata: down,
    storageRegistered: down, oneClickStatus: down, recentTransfers: down, nearTx: down,
    ...over,
  };
}

/** Sources where nothing is found anywhere (every source answered). */
export function empty(over: Partial<Sources> = {}): Sources {
  return fake({
    viewAccount: async () => null, tronTx: async () => null, ethTx: async () => null, btcTx: async () => null,
    ftMetadata: async () => null, storageRegistered: async () => false, oneClickStatus: async () => null,
    recentTransfers: async () => [], nearTx: async () => null, ...over,
  });
}

export const run = (input: Partial<CheckInput> & { to: string }, s: Sources) =>
  check({ network: "testnet", ...input }, s, { now: NOW });

export const find = (r: Awaited<ReturnType<typeof run>>, rule: string) => r.findings.filter((x) => x.rule === rule);
