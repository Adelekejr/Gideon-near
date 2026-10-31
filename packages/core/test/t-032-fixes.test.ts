import { describe, expect, it } from "vitest";
import { parseTxRequest } from "../src/tx/input.js";
import { checkTransaction, MAX_CHECKED_ACCOUNTS } from "../src/tx/check.js";
import type { Sources } from "../src/types.js";
import { NOW, acct, empty } from "./helpers.js";

/*
 * 0.3.2 fixes from the 0.3.1 audit (audit-0.3.1.md). Each block names the finding it covers.
 */
const opts = { now: NOW, drainerTimeoutMs: 2000 };
const NEAR = (n: number) => (BigInt(n) * 10n ** 24n).toString();
const json = (signerId: string | undefined, receiverId: string, actions: unknown[]) => ({ ...(signerId ? { signerId } : {}), receiverId, actions });
const transfer = (n: number) => ({ type: "Transfer", params: { deposit: NEAR(n) } });
const call = (methodName: string, args: unknown, deposit = "1") => ({ type: "FunctionCall", params: { methodName, args, gas: "30000000000000", deposit } });
const codes = (r: { findings: { code: string; status: string }[] }) => r.findings.filter((x) => x.status !== "PASS" && x.status !== "SKIPPED").map((x) => x.code);
/** Every account exists with 100 NEAR and nobody was paid before. */
const live = (over: Partial<Sources> = {}) =>
  empty({ viewAccount: async () => acct(100), sentCount: async () => 0, ftBalance: async () => "1000000", ftMetadata: async () => ({ symbol: "USDT", decimals: 6 } as any), ...over });

describe("H1: an attacker's own transaction in the batch doesn't make their account 'yours'", () => {
  const batch = [json("attacker.near", "attacker.near", [transfer(0)]), json("me.near", "attacker.near", [transfer(99)])];
  it("whole balance to the attacker is no longer SAFE, and the mixed signers are named", async () => {
    for (const myAccounts of [["me.near"], []]) {
      const r = await checkTransaction({ request: batch, network: "mainnet", myAccounts }, live(), opts);
      expect(r.verdict).not.toBe("SAFE");
      expect(codes(r)).toEqual(expect.arrayContaining(["MIXED_SIGNERS", "WHOLE_BALANCE_UNSEEN"]));
    }
  });
  it("token version: ft_transfer of the whole balance to the attacker", async () => {
    const r = await checkTransaction({ request: [json("attacker.near", "attacker.near", []), json("me.near", "usdt.tether-token.near", [call("ft_transfer", { receiver_id: "attacker.near", amount: "1000000" })])], network: "mainnet" }, live(), opts);
    expect(codes(r)).toEqual(expect.arrayContaining(["MIXED_SIGNERS", "WHOLE_BALANCE_UNSEEN"]));
  });
  it("a signer that isn't the account you said signs isn't trusted either", async () => {
    const r = await checkTransaction({ request: json("attacker.near", "attacker.near", [transfer(99)]), network: "mainnet", signerId: "me.near" }, live(), opts);
    expect(codes(r)).toContain("WHOLE_BALANCE_UNSEEN");
  });
  it("one signer sending to itself is still its own account (no false alarm)", async () => {
    const r = await checkTransaction({ request: json("me.near", "me.near", [transfer(99)]), network: "mainnet" }, live(), opts);
    expect(r.verdict).toBe("SAFE");
  });
});

describe("H2: tokens moved by other contract calls get the address checks", () => {
  it("intents.near mt_transfer to a reported scam account is BLOCKED", async () => {
    const r = await checkTransaction({ request: json("me.near", "intents.near", [call("mt_transfer", { receiver_id: "bigbank101.near", token_id: "nep141:wrap.near", amount: NEAR(5) })]), network: "mainnet" }, live(), opts);
    expect(r.verdict).toBe("BLOCKED");
    expect(codes(r)).toContain("REPORTED_SCAM");
  });
  it("mt_batch_transfer to a lookalike of a contact is BLOCKED", async () => {
    const r = await checkTransaction({ request: json("me.near", "intents.near", [call("mt_batch_transfer", { receiver_id: "i11ia.near", token_ids: ["nep141:wrap.near"], amounts: ["5"] })]), network: "mainnet", addressBook: [{ account: "illia.near" }] }, live(), opts);
    expect(r.verdict).toBe("BLOCKED");
  });
  it("a lockup's transfer to a reported scam is BLOCKED", async () => {
    const r = await checkTransaction({ request: json("me.near", "0123456789abcdef.lockup.near", [call("transfer", { amount: NEAR(5), receiver_id: "bigbank101.near" }, "0")]), network: "mainnet" }, live(), opts);
    expect(r.verdict).toBe("BLOCKED");
  });
  it("a receiver that lives only inside intents (not on chain) isn't called missing", async () => {
    const r = await checkTransaction({ request: json("me.near", "intents.near", [call("mt_transfer", { receiver_id: "friend.near", token_id: "nep141:wrap.near", amount: "5" })]), network: "mainnet" },
      live({ viewAccount: async (_n, a) => (a === "friend.near" ? null : acct(100)) }), opts);
    expect(r.verdict).toBe("SAFE");
  });
});

describe("H3: keys that can move funds without being full-access keys", () => {
  it("intents.near add_public_key is ATTENTION", async () => {
    const r = await checkTransaction({ request: json("me.near", "intents.near", [call("add_public_key", { public_key: "ed25519:11111111111111111111111111111111" })]), network: "mainnet" }, live(), opts);
    expect(r.verdict).toBe("ATTENTION");
    expect(r.headline).toMatchObject({ code: "CONTRACT_KEY", title: "This adds a key that can move what you hold in intents.near." });
  });
  it("an app key for your own account's code is ATTENTION; one for a dApp stays SAFE", async () => {
    const key = (receiverId: string) => ({ type: "AddKey", params: { publicKey: "ed25519:11111111111111111111111111111111", accessKey: { permission: { receiverId, methodNames: [] } } } });
    const own = await checkTransaction({ request: json("me.near", "me.near", [key("me.near")]), network: "mainnet" }, live(), opts);
    expect(codes(own)).toContain("SELF_APP_KEY");
    const dapp = await checkTransaction({ request: json("me.near", "me.near", [key("social.near")]), network: "mainnet" }, live(), opts);
    expect(dapp.verdict).toBe("SAFE");
  });
  it("near-api-js shaped actions are read: a FullAccess addKey is BLOCKED", async () => {
    const r = await checkTransaction({ request: json("me.near", "me.near", [{ enum: "addKey", addKey: { publicKey: "ed25519:11111111111111111111111111111111", accessKey: { permission: { fullAccess: {} } } } }]), network: "mainnet" }, live(), opts);
    expect(r.verdict).toBe("BLOCKED");
  });
});

describe("M1: amounts Gideon can't read exactly are never treated as 0", () => {
  for (const bad of ["1e30", "99000000000000000000000000.0", "abc", " 5", -1, 1e26, 1.5]) {
    it(`deposit ${JSON.stringify(bad)}: unreadable, not SAFE, no crash`, async () => {
      const r = await checkTransaction({ request: json("me.near", "stranger.near", [call("go", {}, bad as any)]), network: "mainnet" }, live(), opts);
      expect(r.verdict).toBe("ATTENTION");
      expect(codes(r)).toContain("UNREADABLE_ACTION");
      const t = await checkTransaction({ request: json("me.near", "stranger.near", [{ type: "Transfer", params: { deposit: bad } }]), network: "mainnet" }, live(), opts);
      expect(codes(t)).toContain("UNREADABLE_ACTION");
    });
  }
  it("stake and allowance too", async () => {
    const s = parseTxRequest(json("me.near", "me.near", [{ type: "Stake", params: { stake: "1e30", publicKey: "ed25519:1" } }]));
    expect(s.transactions[0]!.partial).toBe(true);
    const k = parseTxRequest(json("me.near", "me.near", [{ type: "AddKey", params: { publicKey: "ed25519:1", accessKey: { permission: { receiverId: "x.near", allowance: "0.25" } } } }]));
    expect(k.transactions[0]!.partial).toBe(true);
  });
  it("plain integers (string, number, bigint) and a missing deposit still read", async () => {
    for (const ok of ["5", 5, 5n, undefined, ""]) {
      const p = parseTxRequest(json("me.near", "x.near", [{ type: "Transfer", params: { deposit: ok } }]));
      expect(p.transactions[0]!.partial).toBeUndefined();
    }
  });
});

describe("M2: no silent gaps in the money and drained-wallet checks", () => {
  it("no token balance source: COULDN'T CHECK, not a pass", async () => {
    const s = live(); delete (s as any).ftBalance;
    const r = await checkTransaction({ request: json("me.near", "usdt.tether-token.near", [call("ft_transfer", { receiver_id: "stranger.near", amount: "5" })]), network: "mainnet" }, s, opts);
    expect(codes(r)).toContain("BALANCE_UNKNOWN");
    expect(r.verdict).toBe("ATTENTION");
  });
  it(`more than ${MAX_CHECKED_ACCOUNTS} drained-wallet targets: the rest are shown as not checked`, async () => {
    const r = await checkTransaction({ request: json("me.near", "usdt.tether-token.near", Array.from({ length: 8 }, (_, i) => call("ft_transfer", { receiver_id: `s${i}.near`, amount: "1" }))), network: "mainnet" }, live(), opts);
    expect(r.findings.filter((x) => x.code === "DRAINER_UNKNOWN").length).toBe(8 - MAX_CHECKED_ACCOUNTS);
  });
});

describe("L: a long token name is shortened, not printed twice", () => {
  it("BALANCE_UNKNOWN names the token once", async () => {
    const s = live({ ftBalance: async () => { throw new Error("down"); } });
    const r = await checkTransaction({ request: json("me.near", "usdt.tether-token.near", [call("ft_transfer", { receiver_id: "stranger.near", amount: "5" })]), network: "mainnet" }, s, opts);
    expect(r.findings.find((x) => x.code === "BALANCE_UNKNOWN")!.title).toBe("Couldn't check: your usdt.tether-to… balance");
  });
});

describe("L: key permissions Gideon can't read aren't treated as a harmless app key", () => {
  const key = (permission: unknown) => json("me.near", "me.near", [{ type: "AddKey", params: { publicKey: "ed25519:11111111111111111111111111111111", accessKey: { permission } } }]);
  it("'fullaccess' in any case is full access: BLOCKED", async () => {
    for (const p of ["fullaccess", "FULLACCESS", "fullAccess"]) expect((await checkTransaction({ request: key(p), network: "mainnet" }, live(), opts)).verdict).toBe("BLOCKED");
  });
  it("another string, or an app key with no contract, is unreadable", async () => {
    for (const p of ["FunctionCall", { receiverId: "", methodNames: [] }, { methodNames: ["x"] }]) {
      const r = await checkTransaction({ request: key(p), network: "mainnet" }, live(), opts);
      expect(r.verdict).not.toBe("SAFE");
      expect(codes(r)).toContain("UNREADABLE_ACTION");
    }
  });
});
