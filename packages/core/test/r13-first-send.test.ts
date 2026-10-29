import { describe, expect, it } from "vitest";
import { check } from "../src/engine.js";
import { acct, empty, find, NOW, run } from "./helpers.js";

const me = "me.testnet";
const live = (over = {}) => empty({ viewAccount: async () => acct(1), ...over });

describe("R13 first send", () => {
  it("never sent here → ATTENTION FIRST_SEND", async () => {
    const r = await run({ to: "bob.testnet", from: me }, live({ sentCount: async () => 0 }));
    const x = find(r, "R13")[0];
    expect(x.status).toBe("ATTENTION");
    expect(x.code).toBe("FIRST_SEND");
    expect(x.title).toBe("You've never sent to this address before");
    expect(r.verdict).toBe("ATTENTION");
  });
  it("sent before (count) → PASS", async () => {
    const r = await run({ to: "bob.testnet", from: me }, live({ sentCount: async () => 3 }));
    expect(find(r, "R13")[0]).toMatchObject({ status: "PASS", code: "SENT_BEFORE" });
    expect(r.verdict).toBe("SAFE");
  });
  it("sent before (in recent history) → PASS without the count lookup", async () => {
    let asked = 0;
    const r = await run({ to: "bob.testnet", from: me }, live({
      recentTransfers: async () => [{ hash: "t", signer: me, receiver: "bob.testnet", depositYocto: 1e24 }],
      sentCount: async () => { asked++; return 0; },
    }));
    expect(find(r, "R13")[0].code).toBe("SENT_BEFORE");
    expect(asked).toBe(0);
  });
  it("no sender, saved contact, own account, missing account or other network → no note", async () => {
    expect(find(await run({ to: "bob.testnet" }, live({ sentCount: async () => 0 })), "R13")[0].status).toBe("SKIPPED");
    expect(find(await run({ to: "bob.testnet", from: me, addressBook: [{ account: "bob.testnet" }] }, live({ sentCount: async () => 0 })), "R13")[0].status).toBe("PASS");
    expect(find(await run({ to: me, from: me }, live({ sentCount: async () => 0 })), "R13")[0].status).toBe("SKIPPED");
    expect(find(await run({ to: "bob.testnet", from: me }, empty({ sentCount: async () => 0 })), "R13")[0].status).toBe("SKIPPED");
    expect(find(await run({ to: "bob.testnet", from: "me.near" }, live({ sentCount: async () => 0 })), "R13")[0].status).toBe("SKIPPED");
  });
  it("count lookup fails → left out, verdict unchanged", async () => {
    const r = await run({ to: "bob.testnet", from: me }, live({ sentCount: async () => { throw new Error("NearBlocks rate limit reached"); } }));
    expect(find(r, "R13")[0].status).toBe("SKIPPED");
    expect(r.verdict).toBe("SAFE");
    expect(r.sources.find((c) => c.source.includes("sent:"))).toMatchObject({ ok: false, optional: true });
  });
  it("a source without sentCount → left out", async () => {
    const r = await run({ to: "bob.testnet", from: me }, live());
    expect(find(r, "R13")[0].status).toBe("SKIPPED");
  });
  it("token send mentions token transfers aren't counted", async () => {
    const r = await run({ to: "bob.testnet", from: me, asset: { symbol: "USDC", contract: "usdc.fakes.testnet" } }, live({ sentCount: async () => 0, ftMetadata: async () => ({ symbol: "USDC", decimals: 6, name: "USDC" }) as never, storageRegistered: async () => true }));
    expect(find(r, "R13")[0].detail).toContain("token contract");
  });
  it("hung history lookups hit their own limit and never hold the verdict", async () => {
    const hang = () => new Promise<never>(() => {});
    const t0 = Date.now();
    const r = await check({ to: "bob.testnet", network: "testnet", from: me }, live({ recentTransfers: hang, sentCount: hang }),
      { now: NOW, deadlineMs: 2000, sourceTimeoutMs: 1500, historyTimeoutMs: 80 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.verdict).toBe("SAFE");
    expect(find(r, "R7")[0].code).toBe("HISTORY_UNAVAILABLE");
    expect(find(r, "R13")[0].status).toBe("SKIPPED");
    expect(r.findings.some((x) => x.status === "COULD_NOT_CHECK")).toBe(false);
  });
});
