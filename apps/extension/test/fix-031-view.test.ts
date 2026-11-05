import { describe, expect, it } from "vitest";
import { check, checkTransaction, VERDICT_TEXT } from "@gideon/core";
import { acct, empty } from "../../../packages/core/test/helpers.js";
import { card, esc, senderLine, statusLabel, txCard } from "../src/lib/view.js";

const live = empty({ viewAccount: async () => acct(5) });

describe("fix 5: wording on the extension cards", () => {
  it("SAFE send card: NO PROBLEMS FOUND with the approved body", async () => {
    const r = await check({ to: "bob.testnet", network: "testnet", from: "me.testnet", destination: "wallet" }, live);
    expect(r.verdict).toBe("SAFE");
    expect(statusLabel(r)).toBe("NO PROBLEMS FOUND");
    const h = card(r);
    expect(h).toContain("NO PROBLEMS FOUND");
    expect(h).toContain(esc(VERDICT_TEXT.safeBody));
    expect(h).not.toMatch(/LOOKS RIGHT|SAFE TO SEND|Safe to send/);
  });
  it("unknown sender: a visible 'Not checked' line, counted as not checked", async () => {
    const r = await check({ to: "bob.testnet", network: "testnet", destination: "wallet" }, live);
    const h = card(r);
    expect(h).toContain(esc(VERDICT_TEXT.senderUnknown));
    expect(h).toContain("1 not checked");
  });
  it("SAFE transaction card: NOTHING FLAGGED (same words as the CLI and MCP)", async () => {
    const r = await checkTransaction({ request: { signerId: "me.testnet", receiverId: "app.testnet", actions: [{ type: "FunctionCall", params: { methodName: "ping", args: {}, gas: "1", deposit: "0" } }] }, network: "testnet" }, live);
    expect(r.verdict).toBe("SAFE");
    expect(txCard(r)).toContain("NOTHING FLAGGED");
    expect(txCard(r)).not.toContain("LOOKS RIGHT");
    expect(txCard(r)).not.toContain("NO PROBLEMS FOUND");
  });
  it("a readable send is previewed in plain words", async () => {
    const r = await checkTransaction({ request: { signerId: "me.near", receiverId: "bob.near", actions: [{ type: "Transfer", params: { deposit: (2n * 10n ** 24n).toString() } }] }, network: "mainnet" }, live);
    expect(txCard(r)).toContain("You send 2 NEAR to bob.near.");
  });
});

describe("fix 4: 'Is {account} yours?' instead of saving it", () => {
  it("an unconfirmed sender gets the question and the button; a confirmed one doesn't", () => {
    const ask = senderLine({ account: "x.near", why: "from your wallet's header" });
    expect(ask).toContain("Is x.near yours?");
    expect(ask).toContain('data-act="mine"');
    expect(ask).toContain("Add to Your accounts");
    expect(senderLine({ account: "x.near", why: "w", confirmed: true })).not.toContain("data-act=\"mine\"");
  });
});

describe("0.3.2 follow-ups on the extension cards", () => {
  it("an intents transfer shows a 'not checked' line on a NOTHING FLAGGED card", async () => {
    const r = await checkTransaction({ request: { signerId: "me.testnet", receiverId: "intents.testnet", actions: [{ type: "FunctionCall", params: { methodName: "mt_transfer", args: { receiver_id: "bob.testnet", token_id: "a", amount: "1" }, gas: "1", deposit: "1" } }] }, network: "testnet" }, live);
    const h = txCard(r);
    expect(h).toContain("not checked →");
    expect(h).toContain("Couldn&#39;t check: how much of your intents balance this sends");
  });
  it("the Arrow G's label matches the verdict (no 'send cleared')", async () => {
    const r = await checkTransaction({ request: { signerId: "me.testnet", receiverId: "app.testnet", actions: [{ type: "FunctionCall", params: { methodName: "ping", args: {}, gas: "1", deposit: "0" } }] }, network: "testnet" }, live);
    expect(r.verdict).toBe("SAFE");
    const h = txCard(r);
    expect(h).toContain('aria-label="Nothing flagged"');
    expect(h).not.toMatch(/cleared|Wall open/);
  });
});
