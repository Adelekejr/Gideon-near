import { describe, expect, it } from "vitest";
import { checkTransaction } from "../src/tx/check.js";
import { STOP_LABEL, TX_NOT_CHECKED, txNotCheckedLines, VERDICT_TEXT } from "../src/text.js";
import type { Sources } from "../src/types.js";
import { NOW, acct, empty } from "./helpers.js";

/* Follow-ups to the 0.3.2 fixes: intents/lockup balance not checked, empty requests, per-network send memory, labels. */
const opts = { now: NOW, drainerTimeoutMs: 2000 };
const NEAR = (n: number) => (BigInt(n) * 10n ** 24n).toString();
const json = (signerId: string | undefined, receiverId: string, actions: unknown[]) => ({ ...(signerId ? { signerId } : {}), receiverId, actions });
const transfer = (n: number) => ({ type: "Transfer", params: { deposit: NEAR(n) } });
const call = (methodName: string, args: unknown, deposit = "1") => ({ type: "FunctionCall", params: { methodName, args, gas: "30000000000000", deposit } });
const live = (over: Partial<Sources> = {}) =>
  empty({ viewAccount: async () => acct(100), sentCount: async () => 0, ftBalance: async () => "1000000", ftMetadata: async () => ({ symbol: "USDT", decimals: 6 } as any), ...over });
/** Accounts the chain knows and that were paid before, so nothing else is flagged. */
const known = () => live({ sentCount: async () => 3 });

describe("gap 1: intents mt_* and lockup transfers say the balance wasn't checked", () => {
  it("mt_transfer on intents.near: a 'Couldn't check' line, verdict unchanged", async () => {
    const r = await checkTransaction({ request: json("me.near", "intents.near", [call("mt_transfer", { receiver_id: "bob.near", token_id: "nep141:wrap.near", amount: "5" })]), network: "mainnet", myAccounts: ["me.near"], addressBook: [{ account: "bob.near", label: "Bob" } as any] }, known(), opts);
    const nc = r.findings.find((f) => f.code === TX_NOT_CHECKED);
    expect(nc).toMatchObject({ status: "SKIPPED", rule: "T3", title: "Couldn't check: how much of your intents balance this sends" });
    expect(txNotCheckedLines(r)).toEqual([expect.stringMatching(/^Couldn't check: how much of your intents balance this sends\. .*intents\.near/)]);
    expect(r.verdict).toBe("SAFE");
  });
  it("every mt_* variant counts, once per contract", async () => {
    const r = await checkTransaction({ request: json("me.near", "intents.near", [
      call("mt_batch_transfer", { receiver_id: "bob.near", token_ids: ["a"], amounts: ["1"] }),
      call("mt_transfer_call", { receiver_id: "bob.near", token_id: "a", amount: "1", msg: "" }),
    ]), network: "mainnet" }, known(), opts);
    expect(txNotCheckedLines(r)).toHaveLength(1);
  });
  it("a lockup's transfer says 'lockup'", async () => {
    const r = await checkTransaction({ request: json("me.near", "abc.lockup.near", [call("transfer", { receiver_id: "bob.near", amount: NEAR(5) })]), network: "mainnet" }, known(), opts);
    expect(r.findings.find((f) => f.code === TX_NOT_CHECKED)?.title).toBe("Couldn't check: how much of your lockup balance this sends");
  });
  it("it never hides a real warning: the verdict logic is as before", async () => {
    const r = await checkTransaction({ request: json("me.near", "intents.near", [call("mt_transfer", { receiver_id: "bob.near", token_id: "a", amount: "1" }), call("add_public_key", { public_key: "ed25519:abc" })]), network: "mainnet" }, known(), opts);
    expect(txNotCheckedLines(r)).toHaveLength(1);
    expect(r.verdict).toBe("ATTENTION");
    expect(r.headline?.code).toBe("CONTRACT_KEY");
  });
  it("ordinary calls and ft_transfer get no such line", async () => {
    const a = await checkTransaction({ request: json("me.near", "usdt.tether-token.near", [call("ft_transfer", { receiver_id: "bob.near", amount: "5" })]), network: "mainnet" }, known(), opts);
    const b = await checkTransaction({ request: json("me.near", "app.near", [call("ping", {})]), network: "mainnet" }, known(), opts);
    expect(txNotCheckedLines(a)).toEqual([]);
    expect(txNotCheckedLines(b)).toEqual([]);
  });
  it("moving intents to your own account isn't a 'send'", async () => {
    const r = await checkTransaction({ request: json("me.near", "intents.near", [call("mt_transfer", { receiver_id: "me.near", token_id: "a", amount: "1" })]), network: "mainnet" }, known(), opts);
    expect(txNotCheckedLines(r)).toEqual([]);
  });
});

describe("item 7: a request with no actions is 'Couldn't read this request', never SAFE", () => {
  it("one empty transaction", async () => {
    const r = await checkTransaction({ request: json("me.near", "app.near", []), network: "mainnet" }, known(), opts);
    expect(r.verdict).toBe("ATTENTION");
    expect(r.headline).toMatchObject({ status: "COULD_NOT_CHECK", code: "EMPTY_REQUEST", title: "Gideon couldn't read this request" });
  });
  it("an empty transaction next to a normal one", async () => {
    const r = await checkTransaction({ request: [json("me.near", "app.near", [call("ping", {})]), json("me.near", "app.near", [])], network: "mainnet" }, known(), opts);
    expect(r.verdict).not.toBe("SAFE");
    expect(r.findings.some((f) => f.code === "EMPTY_REQUEST")).toBe(true);
  });
  it("a normal request is unaffected", async () => {
    const r = await checkTransaction({ request: json("me.near", "app.near", [call("ping", {})]), network: "mainnet" }, known(), opts);
    expect(r.verdict).toBe("SAFE");
  });
});

describe("item 6: 'sent here before' is kept per network", () => {
  const whole = json("me.near", "bob.near", [transfer(99)]);
  const never = () => live({ sentCount: async () => 0 });
  it("a testnet send doesn't vouch for the same name on mainnet", async () => {
    const r = await checkTransaction({ request: whole, network: "mainnet", deviceSendsByNetwork: { testnet: ["bob.near"] } }, never(), opts);
    expect(r.findings.some((f) => f.code === "WHOLE_BALANCE_UNSEEN")).toBe(true);
  });
  it("a mainnet send does", async () => {
    const r = await checkTransaction({ request: whole, network: "mainnet", deviceSendsByNetwork: { mainnet: ["bob.near"], testnet: [] } }, never(), opts);
    expect(r.findings.some((f) => f.code === "WHOLE_BALANCE_UNSEEN")).toBe(false);
  });
  it("the plain list still works as before", async () => {
    const r = await checkTransaction({ request: whole, network: "mainnet", deviceSends: ["bob.near"] }, never(), opts);
    expect(r.findings.some((f) => f.code === "WHOLE_BALANCE_UNSEEN")).toBe(false);
  });
});

describe("item 4: labels say no more than the verdict", () => {
  it("transaction chip and stop labels", () => {
    expect(VERDICT_TEXT.txSafeChip).toBe("NOTHING FLAGGED");
    expect(STOP_LABEL).toEqual({ block: "Stopped", warn: "Look again", safe: "Nothing flagged", idle: "Checking" });
    expect(Object.values(STOP_LABEL).join(" ")).not.toMatch(/cleared|wall open/i);
  });
});
