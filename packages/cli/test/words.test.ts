import { describe, expect, it } from "vitest";
import { check, checkTransaction, VERDICT_TEXT, withDrainer } from "@gideon/core";
import { acct, empty } from "../../core/test/helpers.js";
import { notCheckedText, sendLabel, sendSafeText, txLabel, txNotCheckedText, txSafeText } from "../src/words.js";

const live = empty({ viewAccount: async () => acct(5) });

describe("0.3.1 fixes on the CLI surface", () => {
  it("SAFE prints NO PROBLEMS FOUND and the approved body (exit code and --json keep SAFE)", async () => {
    const r = await check({ to: "bob.testnet", network: "testnet", from: "me.testnet", destination: "wallet" }, live);
    expect(r.verdict).toBe("SAFE");
    expect(sendLabel(r.verdict)).toBe("NO PROBLEMS FOUND");
    expect(sendSafeText(r)).toEqual(["Account exists. Nothing wrong found.", VERDICT_TEXT.safeBody]);
    expect(sendLabel("BLOCKED")).toBe("BLOCKED");
  });
  it("prints the Not checked line for an unknown sender and a failed drained-wallet check", async () => {
    const r = await check({ to: "bob.testnet", network: "testnet", destination: "wallet" }, live);
    expect(notCheckedText(r)).toEqual([VERDICT_TEXT.senderUnknown]);
    const f = await withDrainer(r, { rule: "R18", status: "SKIPPED", code: "FAILED", title: "x", detail: "" });
    expect(notCheckedText(f)).toContain("Not checked: couldn't check recent senders for hacked wallets.");
  });
  it("check-tx SAFE prints 'Nothing flagged, but check it yourself'", async () => {
    const r = await checkTransaction({ request: JSON.stringify({ signerId: "me.near", receiverId: "wrap.near", actions: [{ type: "FunctionCall", params: { methodName: "near_deposit", args: {}, gas: "30000000000000", deposit: "1000000000000000000000000" } }] }), network: "mainnet" }, live);
    expect(r.verdict).toBe("SAFE");
    expect(txLabel(r.verdict)).toBe("NOTHING FLAGGED");
    // The engine's own T1 headline carries the approved text; the CLI prints it as is.
    expect([r.headline?.title, r.headline?.detail]).toEqual([VERDICT_TEXT.txSafeTitle, VERDICT_TEXT.txSafeBody]);
    expect(txSafeText(r)).toEqual([]);
  });
});

describe("0.3.2 follow-ups on the CLI surface", () => {
  it("check-tx prints the intents balance as not checked, and nothing for a plain call", async () => {
    const mt = await checkTransaction({ request: { signerId: "me.near", receiverId: "intents.near", actions: [{ type: "FunctionCall", params: { methodName: "mt_transfer", args: { receiver_id: "me2.near", token_id: "a", amount: "1" }, gas: "1", deposit: "1" } }] }, network: "mainnet" }, live);
    expect(txNotCheckedText(mt)).toEqual([expect.stringMatching(/^Couldn't check: how much of your intents balance this sends\./)]);
    const plain = await checkTransaction({ request: { signerId: "me.near", receiverId: "wrap.near", actions: [{ type: "FunctionCall", params: { methodName: "near_deposit", args: {}, gas: "1", deposit: "0" } }] }, network: "mainnet" }, live);
    expect(txNotCheckedText(plain)).toEqual([]);
    expect(txLabel("SAFE")).toBe(VERDICT_TEXT.txSafeChip);
  });
  it("an empty request isn't NOTHING FLAGGED", async () => {
    const r = await checkTransaction({ request: { signerId: "me.near", receiverId: "wrap.near", actions: [] }, network: "mainnet" }, live);
    expect(txLabel(r.verdict)).toBe("ATTENTION");
    expect(r.headline?.title).toBe("Gideon couldn't read this request");
  });
});
