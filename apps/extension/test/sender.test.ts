import { describe, expect, it } from "vitest";
import type { Sources } from "@gideon/core";
import { signedInAccount } from "../src/lib/network.js";
import { cachedSources } from "../src/lib/cache.js";
import { checkKey } from "../src/lib/runcache.js";
import { LIMITS } from "../src/lib/limits.js";

describe("sender = the wallet's signed-in account", () => {
  it("one account in the header is the sender", () => {
    expect(signedInAccount([{ text: "hammed.testnet", header: true }, { text: "bob.testnet", header: false }])).toBe("hammed.testnet");
    expect(signedInAccount([{ text: "@Hammed.near", header: true }])).toBe("hammed.near");
  });
  it("none, several, body-only or truncated → no sender", () => {
    expect(signedInAccount([])).toBeNull();
    expect(signedInAccount([{ text: "a.testnet", header: true }, { text: "b.testnet", header: true }])).toBeNull();
    expect(signedInAccount([{ text: "bob.testnet", header: false }])).toBeNull();
    expect(signedInAccount([{ text: "hammed-long…testnet", header: true }])).toBeNull();
    expect(signedInAccount([{ text: "Testnet", header: true }])).toBeNull();
  });
  it("a different sender is a different check (cache key)", () => {
    const base = { to: "bob.testnet", network: "testnet" as const };
    expect(checkKey({ ...base, from: "a.testnet" })).not.toBe(checkKey({ ...base, from: "b.testnet" }));
  });
  it("history fits inside the whole-check limit", () => {
    expect(LIMITS.historyMs).toBeLessThan(LIMITS.totalMs);
    expect(LIMITS.historyMs).toBeLessThanOrEqual(LIMITS.sourceMs);
  });
});

describe("history cache", () => {
  const base = { viewAccount: async () => null } as unknown as Sources;
  it("recent transfers are reused briefly, then asked again", async () => {
    let t = 0, n = 0;
    const s = cachedSources({ ...base, recentTransfers: async () => { n++; return []; } }, 180_000, () => t, 60_000);
    await s.recentTransfers("testnet", "me.testnet");
    await s.recentTransfers("testnet", "me.testnet");
    expect(n).toBe(1);
    t = 61_000;
    await s.recentTransfers("testnet", "me.testnet");
    expect(n).toBe(2);
  });
  it("'sent before' is kept, 'never sent' and failures are asked again", async () => {
    let n = 0, answer = 0;
    const s = cachedSources({ ...base, recentTransfers: async () => [], sentCount: async () => { n++; if (answer < 0) throw new Error("429"); return answer; } }, 180_000, () => 0, 60_000);
    await s.sentCount!("testnet", "me.testnet", "bob.testnet"); await Promise.resolve();
    await s.sentCount!("testnet", "me.testnet", "bob.testnet");
    expect(n).toBe(2);
    answer = -1;
    await expect(s.sentCount!("testnet", "me.testnet", "x.testnet")).rejects.toThrow();
    answer = 3;
    await s.sentCount!("testnet", "me.testnet", "x.testnet");
    await s.sentCount!("testnet", "me.testnet", "x.testnet");
    expect(n).toBe(4);
  });
});
