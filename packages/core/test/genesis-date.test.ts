import { describe, expect, it } from "vitest";
import { check } from "../src/engine.js";
import { acct, empty, find, NOW, run } from "./helpers.js";

/** Accounts from the chain's launch (e.g. illia.near) have no creation transaction, so NearBlocks has no date. */
describe("creation date for genesis accounts", () => {
  const noDate = async () => ({ createdMs: null, indexed: true, indexedHeight: 222_000_000 });

  it("indexer knows it but has no date, and it existed at genesis: dated to NEAR's launch", async () => {
    const asked: string[] = [];
    const r = await check({ to: "illia.near", network: "mainnet" }, empty({
      viewAccount: async () => acct(5), accountCreated: noDate,
      accountAtGenesis: async (n, a) => { asked.push(`${n}:${a}`); return true; },
    }));
    expect(asked).toEqual(["mainnet:illia.near"]);
    expect(r.account?.createdAt).toBe("2020-07-21T16:55:51.591Z");
    expect(r.account?.created).toBe("known");
    expect(r.account?.summary).toContain("Created 21 Jul 2020.");
    expect(find(r, "R11")[0]!.status).toBe("PASS");
  });

  it("not at genesis, or the lookup fails: stays unavailable, not called new, and the verdict is LOOK AGAIN", async () => {
    for (const g of [async () => false, async () => { throw new Error("archival down"); }]) {
      const r = await run({ to: "bob.near", network: "mainnet" }, empty({ viewAccount: async () => acct(5), accountCreated: noDate, accountAtGenesis: g }));
      expect(r.account?.createdAt).toBeUndefined();
      expect(r.account?.summary).toContain("Creation date unavailable.");
      expect(r.verdict).toBe("ATTENTION");
      expect(find(r, "R11")[0]).toMatchObject({ status: "ATTENTION", code: "CREATED_UNKNOWN" });
    }
  });

  it("isn't asked when the indexer has a date or hasn't seen the account", async () => {
    let asked = 0;
    const g = async () => { asked++; return true; };
    await run({ to: "bob.near", network: "mainnet" }, empty({ viewAccount: async () => acct(5), accountCreated: async () => Date.parse("2023-01-01"), accountAtGenesis: g }));
    await run({ to: "bob.near", network: "mainnet" }, empty({ viewAccount: async () => acct(5), accountCreated: async () => ({ createdMs: null, indexed: false, indexedHeight: null }), accountAtGenesis: g }));
    expect(asked).toBe(0);
  });
});

describe("genesis read with no time left", () => {
  it("is recorded as missed, never silently skipped (so the answer isn't treated as complete)", async () => {
    const r = await check({ to: "illia.near", network: "mainnet" }, empty({
      viewAccount: async () => acct(5),
      accountCreated: async () => { await new Promise((res) => setTimeout(res, 60)); return { createdMs: null, indexed: true, indexedHeight: 1 }; },
      accountAtGenesis: async () => true,
    }), { now: NOW, optionalBudgetMs: 50, sourceTimeoutMs: 3000 });
    expect(r.account?.summary).toContain("Creation date unavailable.");
    expect(r.sources.some((c) => c.optional && !c.ok)).toBe(true);
  });
});
