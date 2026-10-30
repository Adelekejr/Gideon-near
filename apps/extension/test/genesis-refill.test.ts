import { describe, expect, it } from "vitest";
import { check, type Sources } from "@gideon/core";
import { cachedSources } from "../src/lib/cache.js";
import { cacheable, missingOptional } from "../src/lib/runcache.js";

/**
 * 0.2.7 bug (popup "Check this send" on a phone): the NearBlocks answer for illia.near ("indexed,
 * no date") came back after the creation-date budget, so the genesis read was skipped silently.
 * The answer then looked complete (cached, no refill), and the popup never asked again anyway.
 */
const info = { amountYocto: "5505996370558712927200013", codeHash: "1".repeat(32), storageUsage: 1307, blockHeight: 222_300_000 };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const opts = { deadlineMs: 6000, sourceTimeoutMs: 3000, optionalBudgetMs: 120, historyTimeoutMs: 2500 };
const input = { to: "illia.near", network: "mainnet" as const, asset: { symbol: "NEAR" }, destination: "wallet" as const };

function slowIndexer(nbMs: number): { s: Sources; calls: { nb: number; genesis: number } } {
  const calls = { nb: 0, genesis: 0 };
  const base = {
    viewAccount: async () => info, tronTx: async () => null, ethTx: async () => null, btcTx: async () => null,
    ftMetadata: async () => null, storageRegistered: async () => false, oneClickStatus: async () => null,
    recentTransfers: async () => [], nearTx: async () => null, communityFlags: async () => [],
    accountCreated: async () => { calls.nb++; await wait(nbMs); return { createdMs: null, indexed: true, indexedHeight: 222_267_433 }; },
    accountAtGenesis: async () => { calls.genesis++; await wait(40); return true; },
  } as unknown as Sources;
  return { s: cachedSources(base, 60_000), calls };
}

describe("launch-day date in the popup (slow indexer)", () => {
  it("a slow first answer is marked incomplete; the quiet refill shows Created 21 Jul 2020", async () => {
    const { s, calls } = slowIndexer(100); // answers inside the budget but leaves too little time for the genesis read
    const first = await check(input, s, opts);
    expect(first.account?.summary).toContain("Creation date unavailable.");
    expect(missingOptional(first)).toBe(true); // → popup and page card ask once more
    expect(cacheable(first)).toBe(false); // → the worker doesn't keep the dateless answer
    const again = await check(input, s, opts);
    expect(again.account?.createdAt).toBe("2020-07-21T16:55:51.591Z");
    expect(again.account?.summary).toContain("Created 21 Jul 2020.");
    expect(calls.nb).toBe(1); // the indexer's dateless answer is remembered, not asked again
    expect(missingOptional(again)).toBe(false);
  });

  it("an indexer slower than the budget: the refill still gets the date from the answer that arrived late", async () => {
    const { s } = slowIndexer(200);
    const first = await check(input, s, opts);
    expect(first.account?.summary).toContain("Creation date unavailable.");
    expect(missingOptional(first)).toBe(true);
    await wait(150); // the popup waits a moment before its refill
    const again = await check(input, s, opts);
    expect(again.account?.summary).toContain("Created 21 Jul 2020.");
  });
});

describe("cache keeps dateless-but-indexed answers", () => {
  it("indexed with no date is kept; not indexed is asked again", async () => {
    let n = 0;
    let indexed = true;
    const s = cachedSources({ viewAccount: async () => info, accountCreated: async () => { n++; return { createdMs: null, indexed, indexedHeight: 1 }; } } as unknown as Sources, 60_000);
    await s.accountCreated!("mainnet", "illia.near");
    await s.accountCreated!("mainnet", "illia.near");
    expect(n).toBe(1);
    indexed = false;
    await s.accountCreated!("mainnet", "fresh.near");
    await s.accountCreated!("mainnet", "fresh.near");
    expect(n).toBe(3);
  });
});
