import { describe, expect, it } from "vitest";
import { encodeTransaction, toBase64, type TxRequest } from "../src/tx/decode.js";
import { parseTxRequest } from "../src/tx/input.js";
import { checkTransaction, LARGE_DEPOSIT_NEAR, WHOLE_BALANCE_SHARE } from "../src/tx/check.js";
import { ruleErrorText } from "../src/engine.js";
import { drainerInputOf, checkDrainer } from "../src/drainer.js";
import { VERDICT_TEXT, notCheckedLines, notCheckedCount, drainerFailed } from "../src/text.js";
import type { Sources } from "../src/types.js";
import { NOW, acct, empty, fake, run } from "./helpers.js";

/*
 * 0.3.1 fixes from the pre-release audit (audit-0.3.0.md). Each block names the fix it covers.
 */

const KEY = "ed25519:DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847";
const opts = { now: NOW, drainerTimeoutMs: 2000 };
const NEAR = (n: number) => (BigInt(Math.round(n * 1000)) * 10n ** 21n).toString();
const json = (signerId: string | undefined, receiverId: string, actions: unknown[]) => ({ ...(signerId ? { signerId } : {}), receiverId, actions });
const transfer = (n: number) => ({ type: "Transfer", params: { deposit: NEAR(n) } });
const codes = (r: { findings: { code: string }[] }) => r.findings.map((x) => x.code);
/** Every account exists with 100 NEAR, except the ones listed as missing. */
const live = (missing: string[] = [], over: Partial<Sources> = {}) =>
  empty({ viewAccount: async (_n, a) => (missing.includes(a) ? null : acct(100)), sentCount: async () => 0, ...over });

describe("fix 1: never green when the check failed or couldn't look", () => {
  it("all sources down: a small transfer to a saved contact is no longer SAFE", async () => {
    const r = await checkTransaction({ request: json("me.near", "friend.near", [transfer(1)]), network: "mainnet", addressBook: [{ account: "friend.near" }], myAccounts: ["me.near"] }, fake(), opts);
    expect(r.verdict).toBe("ATTENTION");
    expect(r.findings.some((x) => x.status === "COULD_NOT_CHECK")).toBe(true);
  });
  it("nothing answered and nothing else to look at: COULDN'T CHECK, not green", async () => {
    // A call to a well-known contract with no signer: there is no account to look up, and all sources are down.
    const r = await checkTransaction({ request: json(undefined, "wrap.near", [{ type: "FunctionCall", params: { methodName: "storage_deposit", args: {}, gas: "1", deposit: "0" } }]), network: "mainnet" }, fake(), opts);
    expect(r.verdict).toBe("ATTENTION");
    expect(r.headline).toMatchObject({ code: "NOT_CHECKED_LIVE", status: "COULD_NOT_CHECK", title: "Gideon couldn't finish checking this request." });
    expect(`${r.headline!.title} ${r.headline!.detail}`).toBe(VERDICT_TEXT.cantCheckBody);
  });
  it("the same request with the signer answering live is green, with the approved wording", async () => {
    const r = await checkTransaction({ request: json("me.near", "wrap.near", [{ type: "FunctionCall", params: { methodName: "storage_deposit", args: {}, gas: "1", deposit: "0" } }]), network: "mainnet" }, live(), opts);
    expect(r.verdict).toBe("SAFE");
    expect(r.headline).toMatchObject({ code: "NOTHING_FOUND", title: VERDICT_TEXT.txSafeTitle, detail: VERDICT_TEXT.txSafeBody });
  });
  it("a request read off the wallet's screen (Meteor) is never green", async () => {
    const r = await checkTransaction({ request: json("victim.near", "stranger-x.near", [transfer(0)]), network: "mainnet", screenOnly: true }, live(), opts);
    expect(r.verdict).toBe("ATTENTION");
    expect(r.headline).toMatchObject({ code: "SCREEN_ONLY", title: VERDICT_TEXT.screenOnlyTitle, detail: VERDICT_TEXT.screenOnlyBody });
  });
  it("a placeholder call with no method name (what the screen reader builds) is never green either", async () => {
    const r = await checkTransaction({ request: json("victim.near", "stranger-x.near", [{ type: "FunctionCall", params: { methodName: "", args: {}, gas: "0", deposit: "0" } }]), network: "mainnet" }, live(), opts);
    expect(codes(r)).toContain("SCREEN_ONLY");
    expect(r.verdict).not.toBe("SAFE");
  });
  it("a plain sign-in (no key, no transaction) stays green: there is nothing to look up", async () => {
    const r = await checkTransaction({ request: "https://app.mynearwallet.com/login/?success_url=https://s.example" }, fake(), opts);
    expect(r.verdict).toBe("SAFE");
    expect(codes(r)).toEqual(["PLAIN_SIGN_IN"]);
  });
  it("a function-call sign-in is never treated as a plain sign-in", async () => {
    const r = await checkTransaction({ request: `https://app.mynearwallet.com/login/?contract_id=app.near&public_key=${KEY}` }, fake(), opts);
    expect(r.verdict).not.toBe("SAFE");
    expect(codes(r)).not.toContain("PLAIN_SIGN_IN");
    expect(codes(r)).toContain("CONTRACT_UNKNOWN");
  });
});

describe("fix 2: DeleteAccount, DeployContract, deposits, Stake, unknown actions", () => {
  it("DeleteAccount to a stranger is BLOCKED with the approved text, even offline", async () => {
    const req = json("me.near", "me.near", [{ type: "DeleteAccount", params: { beneficiaryId: "stranger.near" } }]);
    for (const s of [live(), fake()]) {
      const r = await checkTransaction({ request: req, network: "mainnet" }, s, opts);
      expect(r.verdict).toBe("BLOCKED");
      expect(r.headline).toMatchObject({ rule: "T6", code: "DELETE_ACCOUNT",
        title: "This DELETES your account and sends everything in it to stranger.near.", detail: "Only approve if you meant to close this account." });
    }
  });
  it("DeleteAccount to your own account or a contact is ATTENTION", async () => {
    const req = json("me.near", "me.near", [{ type: "DeleteAccount", params: { beneficiaryId: "savings.near" } }]);
    expect((await checkTransaction({ request: req, network: "mainnet", myAccounts: ["savings.near"] }, live(), opts)).headline).toMatchObject({ code: "DELETE_ACCOUNT_TO_OWN", status: "ATTENTION" });
    const c = await checkTransaction({ request: req, network: "mainnet", addressBook: [{ account: "savings.near" }] }, live(), opts);
    expect(c.verdict).toBe("ATTENTION");
    expect(codes(c)).toContain("DELETE_ACCOUNT_TO_OWN");
  });
  it("DeployContract is BLOCKED with the approved text", async () => {
    const r = await checkTransaction({ request: { signerId: "me.near", receiverId: "me.near", actions: [{ type: "DeployContract", params: { code: [0, 97, 115, 109] } }] }, network: "mainnet" }, live(), opts);
    expect(r.verdict).toBe("BLOCKED");
    expect(r.headline).toMatchObject({ code: "DEPLOY_CONTRACT", title: "This replaces the code on your account.", detail: "Code can move all your funds. Approve only if you wrote or fully trust it." });
  });
  it(`a ${LARGE_DEPOSIT_NEAR}+ NEAR deposit with a call gets a second look, even to a well-known contract`, async () => {
    const big = { type: "FunctionCall", params: { methodName: "deposit", args: {}, gas: "1", deposit: NEAR(50_000) } };
    const r = await checkTransaction({ request: json("me.near", "aurora", [big]), network: "mainnet" }, empty({ viewAccount: async () => acct(60_000), sentCount: async () => 0 }), opts);
    expect(r.verdict).toBe("ATTENTION");
    expect(r.headline).toMatchObject({ code: "LARGE_DEPOSIT", title: "This sends 50,000 NEAR to aurora along with the call." });
    const small = { ...big, params: { ...big.params, deposit: NEAR(1) } };
    expect((await checkTransaction({ request: json("me.near", "aurora", [small]), network: "mainnet" }, live(), opts)).verdict).toBe("SAFE");
  });
  it("a deposit counts toward the whole-balance check", async () => {
    const call = { type: "FunctionCall", params: { methodName: "buy", args: {}, gas: "1", deposit: NEAR(95) } };
    const r = await checkTransaction({ request: json("me.near", "shop-new.near", [call]), network: "mainnet" }, live(), opts);
    expect(codes(r)).toContain("WHOLE_BALANCE_UNSEEN");
  });
  it("Stake is ATTENTION; unstaking all (0) isn't flagged", async () => {
    const stake = (n: number) => ({ type: "Stake", params: { stake: NEAR(n), publicKey: KEY } });
    const r = await checkTransaction({ request: json("me.near", "me.near", [stake(10)]), network: "mainnet" }, live(), opts);
    expect(r.headline).toMatchObject({ code: "STAKE", status: "ATTENTION", title: "This stakes 10 NEAR from your account directly." });
    expect(codes(await checkTransaction({ request: json("me.near", "me.near", [stake(0)]), network: "mainnet" }, live(), opts))).not.toContain("STAKE");
  });
  it("an action type Gideon can't read is COULD_NOT_CHECK, never green", async () => {
    const r = await checkTransaction({ request: json("me.near", "me.near", [{ type: "DeterministicStateInit", params: {} }]), network: "mainnet" }, live(), opts);
    expect(r.verdict).toBe("ATTENTION");
    expect(codes(r)).toContain("UNREADABLE_ACTION");
  });
});

describe("fix 3: address checks on every recipient, contract and beneficiary", () => {
  it("i11ia.near when illia.near is a contact: BLOCKED as a lookalike", async () => {
    const r = await checkTransaction({ request: json("victim.near", "i11ia.near", [transfer(5)]), network: "mainnet", addressBook: [{ account: "illia.near" }] }, live(), opts);
    expect(r.verdict).toBe("BLOCKED");
    const x = r.findings.find((y) => y.code === "LOOKALIKE_OF_CONTACT")!;
    expect(x.detail).toMatch(/^This request uses i11ia\.near\. Your saved contact is illia\.near\./);
  });
  it("a recipient that doesn't exist is BLOCKED (R3)", async () => {
    const r = await checkTransaction({ request: json("victim.near", "nobody-xyz.near", [transfer(1)]), network: "mainnet" }, live(["nobody-xyz.near"]), opts);
    expect(r.verdict).toBe("BLOCKED");
    expect(r.headline).toMatchObject({ rule: "R3", code: "ACCOUNT_NOT_FOUND" });
  });
  it("calling a contract with no account isn't blocked (the call just fails)", async () => {
    const r = await checkTransaction({ request: json("victim.near", "gone.near", [{ type: "FunctionCall", params: { methodName: "x", args: {}, gas: "1", deposit: "0" } }]), network: "mainnet" }, live(["gone.near"]), opts);
    expect(codes(r)).not.toContain("ACCOUNT_NOT_FOUND");
  });
  it("a reported scam is BLOCKED as recipient, as ft_transfer receiver, as called contract and as beneficiary", async () => {
    const reqs = [
      json("me.near", "bigbank101.near", [transfer(1)]),
      json("me.near", "usdt.tether-token.near", [{ type: "FunctionCall", params: { methodName: "ft_transfer", args: { receiver_id: "bigbank101.near", amount: "1" }, gas: "1", deposit: "1" } }]),
      json("me.near", "bigbank101.near", [{ type: "FunctionCall", params: { methodName: "claim", args: {}, gas: "1", deposit: "0" } }]),
      json("me.near", "me.near", [{ type: "DeleteAccount", params: { beneficiaryId: "bigbank101.near" } }]),
    ];
    for (const request of reqs) {
      const r = await checkTransaction({ request, network: "mainnet" }, live(), opts);
      expect(r.verdict).toBe("BLOCKED");
      expect(codes(r)).toContain("REPORTED_SCAM");
    }
  });
  it("fake letters in a recipient are BLOCKED (R15)", async () => {
    const r = await checkTransaction({ request: json("me.near", "\u0430lice.near", [transfer(1)]), network: "mainnet" }, live(), opts);
    expect(r.verdict).toBe("BLOCKED");
    expect(r.findings.find((x) => x.rule === "R15")).toMatchObject({ code: "FAKE_LETTER" });
  });
  it("your own accounts and well-known contracts aren't re-checked (no extra lookups)", async () => {
    const asked: string[] = [];
    const s = live([], { viewAccount: async (_n, a) => { asked.push(a); return acct(100); } });
    await checkTransaction({ request: json("me.near", "savings.near", [transfer(1)]), network: "mainnet", myAccounts: ["savings.near"] }, s, opts);
    expect(asked).toEqual(["me.near"]);
  });
});

describe("fix 6: whole balance can't be dodged by 94% or a split", () => {
  const send = (to: string, n: number) => json("victim.near", to, [transfer(n)]);
  it(`the threshold is ${WHOLE_BALANCE_SHARE * 100}%: 94% is flagged, 89% isn't`, async () => {
    expect(codes(await checkTransaction({ request: send("stranger.near", 94), network: "mainnet" }, live(), opts))).toContain("WHOLE_BALANCE_UNSEEN");
    expect(codes(await checkTransaction({ request: send("stranger.near", 89), network: "mainnet" }, live(), opts))).not.toContain("WHOLE_BALANCE_UNSEEN");
  });
  it("49 + 49 to two strangers counts as 98% and names both", async () => {
    const r = await checkTransaction({ request: [send("stranger0.near", 49), send("stranger1.near", 49)], network: "mainnet" }, live(), opts);
    const x = r.findings.find((y) => y.code === "WHOLE_BALANCE_UNSEEN")!;
    expect(x.title).toBe("This sends your whole NEAR balance to stranger0.near and stranger1.near, which Gideon hasn't seen before.");
    expect(x.evidence?.find((e) => e.label === "Amount")?.value).toBe("98 NEAR");
  });
  it("a split where one part goes to someone you've paid before only counts the rest", async () => {
    const s = live([], { sentCount: async (_n, _f, to) => (to === "friend.near" ? 3 : 0) });
    const r = await checkTransaction({ request: [send("friend.near", 49), send("stranger1.near", 49)], network: "mainnet" }, s, opts);
    expect(codes(r)).not.toContain("WHOLE_BALANCE_UNSEEN");
  });
  it("money moving with no known signer can't be compared: couldn't check", async () => {
    const r = await checkTransaction({ request: json(undefined, "stranger.near", [transfer(99)]), network: "mainnet" }, live(), opts);
    expect(r.findings.find((x) => x.code === "BALANCE_NO_SIGNER")).toMatchObject({ status: "COULD_NOT_CHECK" });
  });
  it("a failed balance read says so in plain words (no raw error)", async () => {
    const s = live([], { viewAccount: async (_n, a) => { if (a === "victim.near") throw new Error("HTTP 502 <html>"); return acct(1); } });
    const r = await checkTransaction({ request: send("stranger.near", 1), network: "mainnet" }, s, opts);
    const x = r.findings.find((y) => y.code === "BALANCE_UNKNOWN")!;
    expect(x.detail).not.toMatch(/502|html/);
  });
});

describe("fix 4: a page-guessed sender doesn't switch off R18 or the whole-balance check", () => {
  const base = { to: "bigbank101.near", network: "mainnet" as const };
  const result = { input: { ...base, from: "bigbank101.near" } } as never;
  it("drainerInputOf drops an untrusted `from`", () => {
    expect(drainerInputOf(result, ["me.near"], false)).not.toHaveProperty("from");
    expect(drainerInputOf(result, ["me.near"])).toHaveProperty("from", "bigbank101.near");
  });
  it("checkDrainer with trustFrom:false still looks at an address the page claims is yours", async () => {
    const r = await run({ to: "planted.testnet", from: "planted.testnet" }, empty({ viewAccount: async () => acct(5), inboundTxs: async () => { throw new Error("indexer down"); }, signedTxsUpTo: async () => [] }));
    const x = await checkDrainer(r, empty({ inboundTxs: async () => { throw new Error("indexer down"); }, signedTxsUpTo: async () => [] }), { trustFrom: false }, { timeoutMs: 500 });
    const r18 = x.findings.find((f) => f.rule === "R18")!;
    expect(r18.code).toBe("FAILED"); // it tried (and failed), instead of "OWN_ACCOUNT"
    expect(r18.status).toBe("COULD_NOT_CHECK");
    expect(drainerFailed(x)).toBe(true);
    expect(x.verdict).toBe("ATTENTION");
  });
  it("a signer guessed from the page doesn't make the recipient 'yours'", async () => {
    // The page claims you are bigbank101.near and asks you to send to bigbank101.near.
    const r = await checkTransaction({ request: json(undefined, "bigbank101.near", [transfer(99)]), network: "mainnet", signerId: "bigbank101.near" }, live(), opts);
    expect(r.verdict).toBe("BLOCKED");
    expect(codes(r)).toContain("REPORTED_SCAM");
    expect(codes(r)).toContain("WHOLE_BALANCE_UNSEEN");
  });
  it("whole balance to an account that isn't in your confirmed accounts is flagged", async () => {
    const r = await checkTransaction({ request: json("victim.near", "bigbank-lookalike.near", [transfer(99)]), network: "mainnet", myAccounts: ["me.near"] }, live(), opts);
    expect(codes(r)).toContain("WHOLE_BALANCE_UNSEEN");
  });
});

describe("fix 7: failures are visible and in plain words", () => {
  it("a failed R18 in a transaction is COULD_NOT_CHECK, not silence", async () => {
    const s = live([], { inboundTxs: async () => { throw new Error("429"); }, signedTxsUpTo: async () => [] });
    const r = await checkTransaction({ request: json("victim.near", "stranger.near", [transfer(1)]), network: "mainnet" }, s, opts);
    expect(r.findings.find((x) => x.code === "DRAINER_UNKNOWN")).toMatchObject({ status: "COULD_NOT_CHECK", title: "Couldn't check: whether stranger.near is linked to hacked wallets" });
    expect(r.verdict).toBe("ATTENTION");
  });
  it("decoder errors are in plain words, inside the usual wrapper", () => {
    const long = toBase64(encodeTransaction({ signerId: "a.near", publicKey: KEY, receiverId: "b.near", actions: [{ type: "FunctionCall", methodName: "x".repeat(5000), args: {}, gas: "1", deposit: "0" }] } as TxRequest & { signerId: string }));
    expect(() => parseTxRequest(long)).toThrow("This isn't a NEAR transaction Gideon can read (a text field in this request is longer than Gideon reads (over 4,096 bytes)).");
    // Key type 9 doesn't exist: patch the signer key's type byte.
    const bytes = encodeTransaction({ signerId: "a.near", publicKey: KEY, receiverId: "b.near", actions: [] });
    bytes[4 + "a.near".length] = 9;
    expect(() => parseTxRequest(toBase64(bytes))).toThrow("This isn't a NEAR transaction Gideon can read (it uses a key type Gideon doesn't recognise).");
    const link = `https://wallet.near.org/sign?transactions=${encodeURIComponent(toBase64(bytes))}`;
    expect(() => parseTxRequest(link)).toThrow("it uses a key type Gideon doesn't recognise");
  });
  it("RULE_ERROR reads as plain words, not 'Internal error'", () => {
    expect(ruleErrorText("Cannot read properties of undefined (reading 'amount')")).toMatch(/^A data source answered with something Gideon couldn't read/);
    expect(ruleErrorText("x")).not.toMatch(/Internal error/);
  });
});

describe("fix 5: unknown sender is 'Not checked', not 'not relevant'", () => {
  it("R13 says SENDER_UNKNOWN and every surface gets the approved line", async () => {
    const r = await run({ to: "bob.testnet" }, empty({ viewAccount: async () => acct(5), sentCount: async () => 0 }));
    expect(r.findings.find((x) => x.rule === "R13")).toMatchObject({ code: "SENDER_UNKNOWN", status: "SKIPPED" });
    expect(notCheckedLines(r)).toEqual([VERDICT_TEXT.senderUnknown]);
    expect(notCheckedCount(r)).toBe(1);
    const known = await run({ to: "bob.testnet", from: "me.testnet" }, empty({ viewAccount: async () => acct(5), sentCount: async () => 0 }));
    expect(notCheckedLines(known)).toEqual([]);
  });
  it("the approved wording is exact", () => {
    expect(VERDICT_TEXT.safeChip).toBe("NO PROBLEMS FOUND");
    expect(VERDICT_TEXT.safeBody).toBe("Gideon checked this address live and found nothing wrong. That isn't a guarantee. Check the address matches the one you were given.");
  });
});
