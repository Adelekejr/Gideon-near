import { describe, expect, it } from "vitest";
import { decodeTransaction, decodeTransactions, encodeTransaction, fromBase64, toBase64, type TxRequest } from "../src/tx/decode.js";
import { parseTxRequest, parseWalletUrl } from "../src/tx/input.js";
import { checkTransaction, daysText } from "../src/tx/check.js";
import type { ChainTx, Sources } from "../src/types.js";
import { NOW, acct, empty, fake } from "./helpers.js";

/** Made with near-api-js 5 (createTransaction / encodeTransaction / SignedTransaction.encode), not by Gideon. */
const NEARJS = {
 "b1": "DgAAAGhhbW1lZC50ZXN0bmV0ALtNxjmyEuB1p1FoWya9zqWSClBBgf8pEOhUl0IScJKgBQAAAAAAAAAOAAAAaGFtbWVkLnRlc3RuZXQPpHP9JpAd8pa+atxMxN800EDvokNSJLaYaRDmMML+9gEAAAAFAE2n4PQJaq8s5V43FlfNMIm6Hp9Z9Nbie9AuRyoWph3BAAAAAAAAAAAB",
 "b2": "DgAAAGhhbW1lZC50ZXN0bmV0ALtNxjmyEuB1p1FoWya9zqWSClBBgf8pEOhUl0IScJKgBgAAAAAAAAAMAAAAd3JhcC50ZXN0bmV0D6Rz/SaQHfKWvmrcTMTfNNBA76JDUiS2mGkQ5jDC/vYHAAAAAgsAAABmdF90cmFuc2ZlcisAAAB7InJlY2VpdmVyX2lkIjoieC50ZXN0bmV0IiwiYW1vdW50IjoiMTAwMCJ9AOBX60gbAAABAAAAAAAAAAAAAAAAAAAAAwAAAKHtzM4bwtMAAAAAAAAFAE2n4PQJaq8s5V43FlfNMIm6Hp9Z9Nbie9AuRyoWph3BAAAAAAAAAAAAAQAAQGg7s/OG8DQAAAAAAAALAAAAYXBwLnRlc3RuZXQCAAAAAQAAAGEBAAAAYgYATafg9AlqryzlXjcWV80wiboen1n01uJ70C5HKhamHcEHCwAAAGJvYi50ZXN0bmV0BAUAAAAAAAAAAAAAAAAAAAAATafg9AlqryzlXjcWV80wiboen1n01uJ70C5HKhamHcEA",
 "b3": "DgAAAGhhbW1lZC50ZXN0bmV0ALtNxjmyEuB1p1FoWya9zqWSClBBgf8pEOhUl0IScJKgBQAAAAAAAAAOAAAAaGFtbWVkLnRlc3RuZXQPpHP9JpAd8pa+atxMxN800EDvokNSJLaYaRDmMML+9gEAAAAFAE2n4PQJaq8s5V43FlfNMIm6Hp9Z9Nbie9AuRyoWph3BAAAAAAAAAAABAAcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc="
};
const KEY = "ed25519:DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847";
const KEY2 = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp";
const DAY = 86_400_000;
const CODE = "8".repeat(44);

const b64 = (t: Omit<TxRequest, "publicKey"> & { signerId: string }) => toBase64(encodeTransaction({ publicKey: KEY, ...t }));

describe("decoding NEAR transactions (borsh)", () => {
  it("reads near-api-js's full-access AddKey", () => {
    const t = decodeTransaction(fromBase64(NEARJS.b1));
    expect(t).toMatchObject({ signerId: "hammed.testnet", receiverId: "hammed.testnet", publicKey: KEY, nonce: "5" });
    expect(t.actions).toEqual([{ type: "AddKey", publicKey: KEY2, fullAccess: true }]);
  });
  it("reads every action kind near-api-js writes", () => {
    const t = decodeTransaction(fromBase64(NEARJS.b2));
    expect(t.receiverId).toBe("wrap.testnet");
    expect(t.actions.map((a) => a.type)).toEqual(["FunctionCall", "Transfer", "AddKey", "DeleteKey", "DeleteAccount", "Stake", "CreateAccount"]);
    expect(t.actions[0]).toMatchObject({ methodName: "ft_transfer", args: { receiver_id: "x.testnet", amount: "1000" }, gas: "30000000000000", deposit: "1" });
    expect(t.actions[1]).toEqual({ type: "Transfer", deposit: (10n ** 24n).toString() });
    expect(t.actions[2]).toEqual({ type: "AddKey", publicKey: KEY2, fullAccess: false, receiverId: "app.testnet", methodNames: ["a", "b"], allowance: "250000000000000000000000" });
    expect(t.actions[4]).toEqual({ type: "DeleteAccount", beneficiaryId: "bob.testnet" });
  });
  it("reads a signed transaction (65-byte signature after it)", () => {
    expect(decodeTransaction(fromBase64(NEARJS.b3)).actions[0]).toMatchObject({ type: "AddKey", fullAccess: true });
  });
  it("reads TransactionV1 (leading 1, trailing priority fee) and gas-key full access", () => {
    const v0 = fromBase64(NEARJS.b1);
    const v1 = new Uint8Array([1, ...v0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(decodeTransaction(v1).actions[0]).toMatchObject({ fullAccess: true });
    // Swap permission 1 (FullAccess) for 3 (GasKeyFullAccess { balance u128, num_nonces u16 }).
    const gas = new Uint8Array([...v0.slice(0, -1), 3, ...new Array(16).fill(0), 2, 0]);
    expect(decodeTransaction(gas).actions[0]).toMatchObject({ fullAccess: true });
  });
  it("marks an action it can't read as partial instead of guessing", () => {
    const t = decodeTransaction(encodeTransaction({ signerId: "a.near", publicKey: KEY, receiverId: "b.near", actions: [{ type: "Transfer", deposit: "1" }, { type: "Unknown", tag: 8 }] }));
    expect(t.partial).toBe(true);
    expect(t.actions.at(-1)).toEqual({ type: "Unknown", tag: 8 });
  });
  it("rejects bytes that aren't a transaction", () => {
    expect(() => decodeTransactions("aGVsbG8gd29ybGQgdGhpcyBpcyBub3QgYSB0eA==")).toThrow();
    expect(() => decodeTransactions("not base64!!")).toThrow();
  });
  it("round-trips its own encoder", () => {
    const tx = { signerId: "a.near", publicKey: KEY, receiverId: "c.near", actions: [{ type: "FunctionCall" as const, methodName: "go", args: { x: 1 }, gas: "5", deposit: "7" }] };
    expect(decodeTransaction(encodeTransaction(tx))).toMatchObject(tx);
  });
});

describe("reading what was pasted", () => {
  const one = b64({ signerId: "hammed.testnet", receiverId: "hammed.testnet", actions: [{ type: "AddKey", publicKey: KEY2, fullAccess: true }] });
  it("MyNearWallet sign link", () => {
    const r = parseWalletUrl(`https://testnet.mynearwallet.com/sign?transactions=${encodeURIComponent(one)}&callbackUrl=https%3A%2F%2Fevil.example%2Fdone`)!;
    expect(r).toMatchObject({ network: "testnet", wallet: "testnet.mynearwallet.com", site: "evil.example", source: "sign-link" });
    expect(r.transactions).toHaveLength(1);
  });
  it("Meteor redirect sign link (/connect/<network>/sign)", () => {
    const r = parseWalletUrl(`https://wallet.meteorwallet.app/connect/mainnet/sign?transactions=${one},${one}&callback_url=https://x.example`)!;
    expect(r).toMatchObject({ network: "mainnet", site: "x.example" });
    expect(r.transactions).toHaveLength(2);
  });
  it("MyNearWallet sign-in without contract_id asks for full access; with one it doesn't", () => {
    expect(parseWalletUrl(`https://app.mynearwallet.com/login/?success_url=https://s.example&public_key=${KEY2}`)!.signIn).toEqual({ fullAccess: true, publicKey: KEY2, site: "s.example" });
    expect(parseWalletUrl(`https://app.mynearwallet.com/login/?contract_id=app.near&public_key=${KEY2}`)!.signIn).toBeUndefined();
  });
  it("raw base64 and wallet-selector JSON", () => {
    expect(parseTxRequest(one).source).toBe("base64");
    const j = parseTxRequest(JSON.stringify({ signerId: "a.near", receiverId: "usdt.tether-token.near", actions: [{ type: "FunctionCall", params: { methodName: "ft_transfer", args: { receiver_id: "b.near", amount: "5" }, gas: "1", deposit: "1" } }] }));
    expect(j.transactions[0]!.actions[0]).toMatchObject({ methodName: "ft_transfer", args: { amount: "5" } });
    expect(parseTxRequest({ transactions: [{ receiverId: "a.near", actions: [{ type: "AddKey", params: { publicKey: KEY2, accessKey: { permission: "FullAccess" } } }] }] }).transactions[0]!.actions[0]).toMatchObject({ fullAccess: true });
  });
  it("plain errors for other input", () => {
    expect(() => parseTxRequest("https://example.com/")).toThrow(/isn't a wallet sign/);
    expect(() => parseTxRequest("")).toThrow(/Nothing to check/);
  });
});

/* ---------- the checks ---------- */

const created = (map: Record<string, number>): Partial<Sources> => ({ accountCreated: async (_n, a) => (a in map ? { createdMs: map[a]!, indexed: true } : null) });
const opts = { now: NOW, drainerTimeoutMs: 2000 };

describe("T1 full access", () => {
  it("AddKey full access → BLOCKED with the approved words", async () => {
    const r = await checkTransaction({ request: b64({ signerId: "hammed.testnet", receiverId: "hammed.testnet", actions: [{ type: "AddKey", publicKey: KEY2, fullAccess: true }] }) }, empty(), opts);
    expect(r.verdict).toBe("BLOCKED");
    expect(r.headline).toMatchObject({ rule: "T1", code: "FULL_ACCESS_KEY", title: "This site is asking for FULL ACCESS to your account.", detail: "A full-access key can move all your funds. Normal sign-ins never need this." });
    expect(r.network).toBe("testnet");
  });
  it("full-access sign-in link → BLOCKED", async () => {
    const r = await checkTransaction({ request: `https://app.mynearwallet.com/login/?success_url=https://s.example&public_key=${KEY2}` }, empty(), opts);
    expect(r.headline).toMatchObject({ code: "FULL_ACCESS_SIGN_IN" });
    expect(r.headline!.evidence![0]).toEqual({ label: "Site", value: "s.example" });
  });
  it("a function-call key (normal sign-in) is fine", async () => {
    const r = await checkTransaction({ request: b64({ signerId: "a.near", receiverId: "a.near", actions: [{ type: "AddKey", publicKey: KEY2, fullAccess: false, receiverId: "app.near", methodNames: [] }] }) }, empty(), opts);
    expect(r.verdict).toBe("SAFE");
    expect(r.findings.map((x) => x.code)).toEqual(["NOTHING_FOUND"]);
  });
});

describe("T2 the contract being called", () => {
  const call = (receiverId: string) => b64({ signerId: "me.near", receiverId, actions: [{ type: "FunctionCall", methodName: "claim", args: {}, gas: "1", deposit: "0" }] });
  const live = (over: Partial<Sources>) => empty({ viewAccount: async (_n, a) => acct(3, a === "me.near" ? undefined : CODE), ...over });
  it("brand-new contract with little history → ATTENTION, approved words", async () => {
    const r = await checkTransaction({ request: call("claim-airdrop.near") }, live({ ...created({ "claim-airdrop.near": NOW - 3 * DAY }), txCount: async () => 12 }), opts);
    expect(r.verdict).toBe("ATTENTION");
    expect(r.headline).toMatchObject({ code: "NEW_CONTRACT", title: "You're about to call claim-airdrop.near.", detail: "It was created 3 days ago and has very little history." });
  });
  it("new but busy, or old: no warning", async () => {
    expect((await checkTransaction({ request: call("busy.near") }, live({ ...created({ "busy.near": NOW - 3 * DAY }), txCount: async () => 50_000 }), opts)).verdict).toBe("SAFE");
    expect((await checkTransaction({ request: call("old.near") }, live({ ...created({ "old.near": NOW - 400 * DAY }), txCount: async () => 3 }), opts)).verdict).toBe("SAFE");
  });
  it("well-known contracts aren't even looked up", async () => {
    let asked = 0;
    const r = await checkTransaction({ request: call("v2.ref-finance.near") }, live({ accountCreated: async () => { asked++; return NOW; } }), opts);
    expect(r.verdict).toBe("SAFE");
    expect(asked).toBe(0);
  });
  it("days wording", () => {
    expect([0, 1, 2].map(daysText)).toEqual(["less than a day", "1 day", "2 days"]);
  });
  it("lookup down → COULD_NOT_CHECK, never SAFE", async () => {
    const r = await checkTransaction({ request: call("x.near") }, fake(), opts);
    expect(r.verdict).toBe("ATTENTION");
    expect(r.findings[0]).toMatchObject({ status: "COULD_NOT_CHECK", code: "CONTRACT_UNKNOWN" });
  });
  it("contract linked to drained wallets → BLOCKED with the approved words", async () => {
    const T = NOW - 60_000;
    const victims = ["v1.near", "v2.near"].map((v, i) => {
      const add: ChainTx = { hash: `a${i}`, signer: v, signerKey: "old", receiver: v, timestampMs: T - 120_000, blockHeight: 100 + i, actions: [{ kind: "addKey", publicKey: "new", fullAccess: true }] };
      const drain: ChainTx = { hash: `d${i}`, signer: v, signerKey: "new", receiver: "drain.near", timestampMs: T, blockHeight: 200 + i, actions: [{ kind: "transfer", depositYocto: "1" }] };
      return { v, add, drain };
    });
    const s = live({
      viewAccount: async (_n, a) => (a.startsWith("v") ? acct(0.01) : acct(3, CODE)),
      ...created({ "drain.near": NOW - 900 * DAY }),
      inboundTxs: async () => ({ total: 2, txs: victims.map((x) => x.drain) }),
      signedTxsUpTo: async (_n, a) => { const x = victims.find((y) => y.v === a)!; return [x.drain, x.add]; },
    });
    const r = await checkTransaction({ request: call("drain.near") }, s, opts);
    expect(r.verdict).toBe("BLOCKED");
    expect(r.headline).toMatchObject({ rule: "T2", code: "DRAINER_LINKED", title: "drain.near is linked to accounts that drained other wallets." });
  });
});

describe("T3 whole balance to an account Gideon hasn't seen", () => {
  const ftSend = (amount: string, to = "stranger.near", contract = "usdt.tether-token.near", method = "ft_transfer") =>
    b64({ signerId: "me.near", receiverId: contract, actions: [{ type: "FunctionCall", methodName: method, args: { receiver_id: to, amount }, gas: "1", deposit: "1" }] });
  const s = (over: Partial<Sources> = {}) => empty({ viewAccount: async (_n, a) => acct(10, a.includes("tether") ? CODE : undefined), ftBalance: async () => "100000000", ftMetadata: async () => ({ name: "Tether USD", symbol: "USDt", decimals: 6 }), ...over });
  it("all your USDt to a stranger → ATTENTION, approved words", async () => {
    const r = await checkTransaction({ request: ftSend("100000000") }, s(), opts);
    expect(r.verdict).toBe("ATTENTION");
    expect(r.headline).toMatchObject({ rule: "T3", code: "WHOLE_BALANCE_UNSEEN", title: "This sends your whole USDt balance to stranger.near, which Gideon hasn't seen before." });
    expect(r.headline!.evidence![0]).toEqual({ label: "Amount", value: "100 USDt" });
  });
  it("ft_transfer_call counts too; 95% counts as whole", async () => {
    expect((await checkTransaction({ request: ftSend("95000000", "stranger.near", "usdt.tether-token.near", "ft_transfer_call") }, s(), opts)).headline?.rule).toBe("T3");
  });
  it("part of the balance, a contact, or a well-known receiver: no warning", async () => {
    expect((await checkTransaction({ request: ftSend("50000000") }, s(), opts)).verdict).toBe("SAFE");
    expect((await checkTransaction({ request: ftSend("100000000"), addressBook: [{ name: "Ada", account: "stranger.near" }] }, s(), opts)).verdict).toBe("SAFE");
    expect((await checkTransaction({ request: ftSend("100000000", "v2.ref-finance.near", "usdt.tether-token.near", "ft_transfer_call") }, s(), opts)).verdict).toBe("SAFE");
  });
  it("all your NEAR to a stranger", async () => {
    const r = await checkTransaction({ request: b64({ signerId: "me.near", receiverId: "stranger.near", actions: [{ type: "Transfer", deposit: (10n * 10n ** 24n).toString() }] }) }, s({ sentCount: async () => 0 }), opts);
    expect(r.headline).toMatchObject({ title: "This sends your whole NEAR balance to stranger.near, which Gideon hasn't seen before." });
  });
  it("NEAR to someone you've sent to before: no warning", async () => {
    const r = await checkTransaction({ request: b64({ signerId: "me.near", receiverId: "friend.near", actions: [{ type: "Transfer", deposit: (10n * 10n ** 24n).toString() }] }) }, s({ sentCount: async () => 3 }), opts);
    expect(r.verdict).toBe("SAFE");
  });
  it("balance lookup down → COULD_NOT_CHECK", async () => {
    const r = await checkTransaction({ request: ftSend("100000000") }, s({ ftBalance: async () => { throw new Error("down"); } }), opts);
    expect(r.findings.find((x) => x.rule === "T3")).toMatchObject({ status: "COULD_NOT_CHECK" });
  });
});

describe("T4 NFT control", () => {
  const nft = (method: string, args: object) => b64({ signerId: "me.near", receiverId: "x.paras.near", actions: [{ type: "FunctionCall", methodName: method, args, gas: "1", deposit: "1" }] });
  const s = empty({ viewAccount: async () => acct(1, CODE), nftToken: async () => ({ title: "Sunset #4" }) });
  it("nft_approve to a stranger → ATTENTION, approved words", async () => {
    const r = await checkTransaction({ request: nft("nft_approve", { token_id: "4", account_id: "stranger.near" }) }, s, opts);
    expect(r.headline).toMatchObject({ rule: "T4", title: "This lets stranger.near move your NFT Sunset #4 (#4)." });
  });
  it("nft_transfer_call to a stranger; approving a marketplace is fine", async () => {
    expect((await checkTransaction({ request: nft("nft_transfer_call", { token_id: "4", receiver_id: "stranger.near", msg: "" }) }, s, opts)).headline?.rule).toBe("T4");
    expect((await checkTransaction({ request: nft("nft_approve", { token_id: "4", account_id: "marketplace.paras.near" }) }, s, opts)).verdict).toBe("SAFE");
  });
});

describe("the demo request: full access plus a whole-balance send", () => {
  it("BLOCKED, full access first, then the whole-balance warning", async () => {
    const req = [
      b64({ signerId: "hammed.testnet", receiverId: "hammed.testnet", actions: [{ type: "AddKey", publicKey: KEY2, fullAccess: true }] }),
      b64({ signerId: "hammed.testnet", receiverId: "gideon-demo-nobody.testnet", actions: [{ type: "Transfer", deposit: (5n * 10n ** 24n).toString() }] }),
    ].join(",");
    const r = await checkTransaction({ request: `https://testnet.mynearwallet.com/sign?transactions=${req}` }, empty({ viewAccount: async (_n, a) => (a === "hammed.testnet" ? acct(5) : null), sentCount: async () => 0 }), opts);
    expect(r.verdict).toBe("BLOCKED");
    expect(r.findings.map((x) => x.code)).toEqual(["FULL_ACCESS_KEY", "WHOLE_BALANCE_UNSEEN"]);
  });
});
