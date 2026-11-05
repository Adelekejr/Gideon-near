import { describe, expect, it } from "vitest";
import { VERDICT_TEXT } from "../src/text.js";
import { acct, empty, find, NOW, run } from "./helpers.js";

const H = 3_600_000;
const D = 24 * H;
const at = (ms: number) => async () => ({ createdMs: ms, indexed: true, indexedHeight: 1000 });
const live = (over: object) => empty({ viewAccount: async () => ({ ...acct(10), blockHeight: 2000 }), ...over });

describe("R11 account age (brand-new accounts)", () => {
  it("created under 24h ago → ATTENTION, and it still says the account really exists", async () => {
    const r = await run({ to: "lifeguard-x.testnet" }, live({ accountCreated: at(NOW - 2 * H) }));
    expect(r.verdict).toBe("ATTENTION");
    expect(r.headline?.code).toBe("NEW_ACCOUNT_TODAY");
    expect(r.headline?.detail).toBe("Brand-new account, created today. It really exists on NEAR testnet (checked live). Confirm with the recipient before sending.");
    expect(find(r, "R3")[0]).toMatchObject({ status: "PASS", code: "ACCOUNT_EXISTS" });
    expect(r.account).toMatchObject({ exists: true, created: "known" });
  });

  it("created 3 days ago → softer ATTENTION with the day count", async () => {
    const r = await run({ to: "bob.testnet" }, live({ accountCreated: at(NOW - 3 * D - H) }));
    expect(r.verdict).toBe("ATTENTION");
    expect(find(r, "R11")[0]).toMatchObject({ status: "ATTENTION", code: "NEW_ACCOUNT", title: "New account (created 3 days ago)" });
  });

  it("1 day old → singular wording", async () => {
    const r = await run({ to: "bob.testnet" }, live({ accountCreated: at(NOW - D - H) }));
    expect(find(r, "R11")[0].title).toBe("New account (created 1 day ago)");
  });

  it("old account (2022) → PASS, SAFE", async () => {
    const r = await run({ to: "adelekejr.testnet" }, live({ accountCreated: at(Date.parse("2022-04-30T06:52:09Z")) }));
    expect(r.verdict).toBe("SAFE");
    expect(find(r, "R11")[0]).toMatchObject({ status: "PASS", code: "ACCOUNT_AGE", title: "Account created 30 Apr 2022" });
  });

  it("exactly 7 days → no longer new", async () => {
    const r = await run({ to: "bob.testnet" }, live({ accountCreated: at(NOW - 7 * D) }));
    expect(find(r, "R11")[0].status).toBe("PASS");
  });

  it("exists on chain but the lagging indexer has no record → ATTENTION 'newer than our indexer's data'", async () => {
    const r = await run({ to: "fresh.testnet" }, live({ accountCreated: async () => ({ createdMs: null, indexed: false, indexedHeight: 1000 }) }));
    expect(r.verdict).toBe("ATTENTION");
    const x = find(r, "R11")[0];
    expect(x).toMatchObject({ status: "ATTENTION", code: "NEW_ACCOUNT_UNINDEXED", title: "Created recently (newer than our indexer's data)" });
    expect(x.detail).toMatch(/Exists on chain/);
    expect(x.detail).toMatch(/1,000 blocks behind/);
    expect(r.account).toMatchObject({ created: "after-indexer", indexerLagBlocks: 1000, indexedHeight: 1000 });
    expect(r.account?.summary).toBe("Account exists on NEAR testnet. Created recently (newer than our indexer's data). Holds 10 NEAR.");
  });

  it("an old account the lagging indexer knows (no date) is NOT called new, and it is not SAFE", async () => {
    const r = await run({ to: "genesis.testnet" }, live({ accountCreated: async () => ({ createdMs: null, indexed: true, indexedHeight: 1000 }) }));
    expect(r.verdict).toBe("ATTENTION");
    expect(find(r, "R11")[0]).toMatchObject({ status: "ATTENTION", code: "CREATED_UNKNOWN", title: "Not checked: when this account was created" });
    expect(find(r, "R11")[0].code).not.toMatch(/NEW_ACCOUNT/);
    expect(r.findings.map((f) => f.title).join(" ")).toContain(VERDICT_TEXT.ageUnknown.split(".")[0]);
  });

  it("indexer down → a Not checked line, and the verdict is LOOK AGAIN, never SAFE", async () => {
    const r = await run({ to: "bob.testnet" }, live({ accountCreated: async () => { throw new Error("rate limited"); } }));
    expect(r.verdict).toBe("ATTENTION");
    expect(r.account?.summary).toMatch(/Creation date unavailable\./);
    expect(find(r, "R11")[0]).toMatchObject({ status: "ATTENTION", code: "CREATED_UNKNOWN", title: "Not checked: when this account was created" });
    expect(find(r, "R3")[0].evidence).toContainEqual({ label: "Created", value: "date unavailable" });
  });

  it("no indexer source at all → still says 'Creation date unavailable', and nothing failed so the verdict can be SAFE", async () => {
    const r = await run({ to: "bob.testnet" }, empty({ viewAccount: async () => acct(1) }));
    expect(r.account?.summary).toMatch(/Creation date unavailable/);
    expect(r.verdict).toBe("SAFE");
    expect(find(r, "R11")[0].status).toBe("PASS");
  });

  it("wallet flow (sender given) still looks up the date", async () => {
    let asked = 0;
    const r = await run({ to: "bob.testnet", from: "me.testnet" }, live({ accountCreated: async () => { asked++; return { createdMs: NOW - H, indexed: true }; } }));
    expect(asked).toBe(1);
    expect(r.headline?.code).toBe("NEW_ACCOUNT_TODAY");
  });

  it("missing or unknown account → R11 skipped (R3 handles it)", async () => {
    const r = await run({ to: "nobody.testnet" }, empty());
    expect(find(r, "R11")[0].status).toBe("SKIPPED");
  });

  it("older sources returning a bare ms number still work", async () => {
    const r = await run({ to: "bob.testnet" }, live({ accountCreated: async () => NOW - 2 * H }));
    expect(r.headline?.code).toBe("NEW_ACCOUNT_TODAY");
  });

  it("lookalike that is also brand-new → BLOCKED by the lookalike, age shown as extra", async () => {
    const r = await run({ to: "adelekejrr.testnet", addressBook: [{ account: "adelekejr.testnet", label: "Me" }] },
      live({ accountCreated: at(NOW - H) }));
    expect(r.verdict).toBe("BLOCKED");
    expect(find(r, "R11")[0].code).toBe("NEW_ACCOUNT_TODAY");
  });

  describe("indexer behind → dated from archival chain state", () => {
    const unindexed = async () => ({ createdMs: null, indexed: false, indexedHeight: 1000 });
    // Account created `ageMs` ago: it existed at t only if t >= creation.
    const chain = (ageMs: number) => async (_n: string, _a: string, t: number) => t >= NOW - ageMs;

    it("didn't exist 24h ago → 'Brand-new account, created today'", async () => {
      const r = await run({ to: "fresh.testnet" }, live({ accountCreated: unindexed, accountExistedAt: chain(5 * H) }));
      expect(r.headline?.code).toBe("NEW_ACCOUNT_TODAY");
      expect(r.account).toMatchObject({ created: "after-indexer", chainAgeDays: 0 });
      expect(r.account?.summary).toContain("Created in the last 24 hours.");
    });

    it("existed 1 day ago but not 7 → 'New account (created N days ago)' with the right N", async () => {
      for (const n of [1, 2, 3, 4, 5, 6]) {
        const r = await run({ to: "fresh.testnet" }, live({ accountCreated: unindexed, accountExistedAt: chain(n * D + H) }));
        expect(find(r, "R11")[0]).toMatchObject({ status: "ATTENTION", code: "NEW_ACCOUNT", title: `New account (created ${n} day${n === 1 ? "" : "s"} ago)` });
      }
    });

    it("already existed 7 days ago → not new, SAFE (a missed old account is never called new)", async () => {
      const r = await run({ to: "old.testnet" }, live({ accountCreated: unindexed, accountExistedAt: chain(900 * D) }));
      expect(r.verdict).toBe("SAFE");
      expect(find(r, "R11")[0]).toMatchObject({ status: "PASS", code: "ACCOUNT_AGE", title: "Account is more than 7 days old" });
    });

    it("archival lookup fails → falls back to 'newer than our indexer's data' ATTENTION", async () => {
      const r = await run({ to: "fresh.testnet" }, live({ accountCreated: unindexed, accountExistedAt: async () => { throw new Error("archival down"); } }));
      expect(find(r, "R11")[0].code).toBe("NEW_ACCOUNT_UNINDEXED");
      expect(r.sources.some((c) => c.source.startsWith("archival-rpc-testnet") && !c.ok && c.optional)).toBe(true);
    });

    it("never asks archival when the indexer already dated the account", async () => {
      let asked = 0;
      await run({ to: "bob.testnet" }, live({ accountCreated: at(NOW - 400 * D), accountExistedAt: async () => { asked++; return true; } }));
      expect(asked).toBe(0);
    });
  });
});
