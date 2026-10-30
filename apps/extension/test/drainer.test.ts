import { describe, expect, it } from "vitest";
import { check, withDrainer, verdictFinding, type CheckResult } from "@gideon/core";
import { card, drainerLine } from "../src/lib/view.js";
import { sendDrainer } from "../src/lib/messages.js";
import { empty } from "../../../packages/core/test/helpers.js";

const live = empty({ viewAccount: async () => ({ amountYocto: "5000000000000000000000000", codeHash: "11111111111111111111111111111111", storageUsage: 182 }) });
const hit = (a: string) => ({ account: a, tx: "tx1", minutesAfterKey: 1, leftNear: "0.05" });
const up = () => true;

describe("drained-wallet line on the card (R18)", () => {
  it("pending while it looks, the all-clear after, nothing when skipped", async () => {
    const r = await check({ to: "bob.testnet", network: "testnet", destination: "wallet" }, live);
    expect(card(r, { drainerPending: true })).toContain("checking recent senders for hacked wallets…");
    expect(card(r)).not.toContain("senders →");
    const pass = await withDrainer(r, verdictFinding([], 5, "testnet"));
    expect(pass.verdict).toBe("SAFE");
    expect(drainerLine(pass)).toContain("No sign of hacked wallets sending here");
    const skipped = await withDrainer(r, { rule: "R18", status: "SKIPPED", code: "FAILED", title: "Drained-wallet check didn't run", detail: "" });
    expect(drainerLine(skipped, true)).toBe("");
  });
  it("a BLOCK becomes the card's headline (no duplicate line)", async () => {
    const r = await check({ to: "bob.testnet", network: "testnet", destination: "wallet" }, live);
    const b = await withDrainer(r, verdictFinding([hit("a.testnet"), hit("b.testnet")], 5, "testnet"));
    expect(b.verdict).toBe("BLOCKED");
    const html = card(b);
    expect(html).toContain("Funds from hacked wallets were swept into this address");
    expect(drainerLine(b)).toBe("");
  });
});

describe("sendDrainer never throws or hangs", () => {
  const r = {} as CheckResult;
  it("time-out, error, failure and orphaned script all answer null", async () => {
    expect(await sendDrainer(r, 50, () => new Promise(() => {}), up)).toBeNull();
    expect(await sendDrainer(r, 50, async () => { throw new Error("Receiving end does not exist"); }, up)).toBeNull();
    expect(await sendDrainer(r, 50, async () => ({ ok: false, error: "x" }), up)).toBeNull();
    expect(await sendDrainer(r, 50, async () => undefined, up)).toBeNull();
    expect(await sendDrainer(r, 50, async () => ({ ok: true, result: r }), () => false)).toBeNull();
    expect(await sendDrainer(r, 50, async () => ({ ok: true, result: r }), up)).toBe(r);
  });
});
