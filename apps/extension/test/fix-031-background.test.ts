import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeTransaction, toBase64 } from "@gideon/core";
import { acct, empty } from "../../../packages/core/test/helpers.js";

/*
 * 0.3.1: the worker never saves an account read off the page as "yours" (account planting), only
 * trusts a sender for the drained-wallet check once you confirmed it, and passes "read off the
 * screen" through to the transaction check. Sources are stubbed: every lookup answers, nothing found.
 */
const store: Record<string, unknown> = {};
vi.stubGlobal("chrome", {
  storage: { local: {
    get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in store).map((k) => [k, store[k]])),
    set: async (o: Record<string, unknown>) => { Object.assign(store, o); },
  } },
  runtime: { onMessage: { addListener: () => undefined }, onInstalled: { addListener: () => undefined } },
});
vi.mock("@gideon/sources", () => ({
  liveSources: () => empty({
    viewAccount: async (_n: string, id: string) => (id.endsWith(".testnet") ? acct(5) : null),
    inboundTxs: async () => ({ total: 0, txs: [] }), signedTxsUpTo: async () => [],
  }),
}));
const bg = await import("../src/background.js");

beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; });

describe("fix 4: account planting (extension worker)", () => {
  it("a sender read from the page header is never saved to Your accounts", async () => {
    const { sender } = await bg.runRequest({ type: "gideon:check", input: { to: "bob.testnet", network: "testnet" }, host: "x", sender: { account: "planted.testnet", via: "header" } });
    expect(store.myAccounts).toBeUndefined();
    expect(sender?.account).toBe("planted.testnet");
    expect(sender?.confirmed).toBeUndefined(); // the card then asks "Is planted.testnet yours?"
  });
  it("an account you added yourself is confirmed", async () => {
    store.myAccounts = ["me.testnet"];
    const { sender } = await bg.runRequest({ type: "gideon:check", input: { to: "bob.testnet", network: "testnet" }, host: "x", sender: { account: "me.testnet", via: "header" } });
    expect(sender?.confirmed).toBe(true);
  });
  it("an unconfirmed sender doesn't switch off the drained-wallet check (R18)", async () => {
    const { result } = await bg.runRequest({ type: "gideon:check", input: { to: "victim.testnet", network: "testnet" }, host: "x", sender: { account: "victim.testnet", via: "header" } });
    // The planted name equals the recipient: it isn't treated as "your own account".
    expect(result.findings.find((f) => f.rule === "R7")?.code).not.toBe("OWN_ACCOUNT");
    const merged = await bg.runDrainer({ type: "gideon:drainer", result });
    expect(merged.findings.find((f) => f.rule === "R18")).toBeDefined();
    expect(merged.findings.find((f) => f.rule === "R18")?.code).not.toBe("OWN_ACCOUNT");
    store.myAccounts = ["victim.testnet"];
    const mine = await bg.runDrainer({ type: "gideon:drainer", result });
    expect(mine.findings.find((f) => f.rule === "R18")?.code).toBe("OWN_ACCOUNT");
  });
});

describe("fix 1: a request read off the wallet's screen is never green (extension worker)", () => {
  it("screenOnly → COULDN'T CHECK with the Meteor text, not SAFE", async () => {
    const r = await bg.runTx({ type: "gideon:tx", host: "wallet.meteorwallet.app", network: "testnet", screenOnly: true, request: { signerId: "me.testnet", receiverId: "app.testnet", actions: [{ type: "FunctionCall", params: { methodName: "", args: {}, gas: "0", deposit: "0" } }] } });
    expect(r.verdict).not.toBe("SAFE");
    expect(r.findings.map((f) => f.code)).toContain("SCREEN_ONLY");
  });
  it("the same request from a full wallet link can be SAFE", async () => {
    const KEY = "ed25519:" + "1".repeat(43);
    const b64 = toBase64(encodeTransaction({ signerId: "me.testnet", publicKey: KEY, receiverId: "app.testnet", actions: [{ type: "FunctionCall", methodName: "ping", args: "", gas: "30000000000000", deposit: "0" }] }));
    const r = await bg.runTx({ type: "gideon:tx", host: "x", network: "testnet", request: b64 });
    expect(r.verdict).toBe("SAFE");
  });
});

describe("0.3.2 follow-up: 'sent here before' is kept per network (extension worker)", () => {
  const whole = { signerId: "me.testnet", receiverId: "bob.testnet", actions: [{ type: "Transfer", params: { deposit: (5n * 10n ** 24n).toString() } }] };
  it("a mainnet send to the same name doesn't count on testnet", async () => {
    store.sends = [{ network: "mainnet", to: "bob.testnet", at: 1 }];
    const r = await bg.runTx({ type: "gideon:tx", host: "x", network: "testnet", request: whole });
    expect(r.findings.map((f) => f.code)).toContain("WHOLE_BALANCE_UNSEEN");
  });
  it("a testnet send does", async () => {
    store.sends = [{ network: "testnet", to: "bob.testnet", at: 1 }];
    const r = await bg.runTx({ type: "gideon:tx", host: "x", network: "testnet", request: whole });
    expect(r.findings.map((f) => f.code)).not.toContain("WHOLE_BALANCE_UNSEEN");
  });
});
