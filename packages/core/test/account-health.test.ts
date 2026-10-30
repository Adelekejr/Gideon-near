import { describe, expect, it } from "vitest";
import { accountHealth, deleteKeyLinks, HEALTH_TEXT, readNonce, removeKeyPlan } from "../src/health.js";
import { parseTxRequest } from "../src/tx/input.js";
import type { AccessKeyEntry, ChainTx, KeyRecord, Sources } from "../src/types.js";
import { NOW, acct, empty } from "./helpers.js";

const DAY = 86_400_000;
const ME = "me.near";
const K = (n: number) => `ed25519:${String(n).repeat(4)}${"A".repeat(40)}`.slice(0, 52);
const FA = (n: number, nonce = "5"): AccessKeyEntry => ({ publicKey: K(n), nonce, permission: "FullAccess" });
const FC = (n: number, receiverId: string, methodNames: string[] = ["post"], allowanceYocto: string | null = "250000000000000000000000", nonce = "0"): AccessKeyEntry =>
  ({ publicKey: K(n), nonce, permission: { receiverId, methodNames, allowanceYocto } });
const rec = (n: number, fullAccess: boolean, createdMs: number | null, createdTx: string | null = null, deletedMs: number | null = null, deletedTx: string | null = null): KeyRecord =>
  ({ publicKey: K(n), fullAccess, createdMs, createdTx, deletedMs, deletedTx });
let h = 0;
const tx = (signerKey: string, ms: number, actions: ChainTx["actions"], receiver = ME): ChainTx =>
  ({ hash: `h${++h}`, signer: ME, signerKey, receiver, timestampMs: ms, blockHeight: Math.floor(ms / 1000), actions });

function src(o: { keys: AccessKeyEntry[] | null; recs?: KeyRecord[]; hist?: ChainTx[]; extra?: ChainTx[]; balance?: number; over?: Partial<Sources> }): Sources {
  const extra = new Map((o.extra ?? []).map((t) => [t.hash, t]));
  return empty({
    viewAccount: async (_n, a) => (a === ME ? acct(o.balance ?? 50) : null),
    accessKeys: async () => o.keys,
    keyRecords: async () => o.recs ?? [],
    signedTxs: async () => o.hist ?? [],
    txsByHash: async (_n, hs) => hs.flatMap((x) => (extra.has(x) ? [extra.get(x)!] : [])),
    blockTimeMs: async () => null,
    ...o.over,
  });
}
const run = (s: Sources, account = ME) => accountHealth({ account }, s, { now: NOW, retryDelayMs: 0 });

describe("account health: normal accounts stay clean, with a tidy-up list", () => {
  it("one wallet key and limited app keys: no warning signs, wallet key marked", async () => {
    const r = await run(src({
      keys: [FA(1, "120000000000017"), FC(2, "social.near"), FC(3, "app.example.near", ["vote"])],
      recs: [rec(1, true, NOW - 400 * DAY), rec(2, false, NOW - 20 * DAY), rec(3, false, NOW - 10 * DAY)],
      hist: [tx(K(1), NOW - 2 * DAY, [{ kind: "other" }]), tx(K(2), NOW - 3 * DAY, [{ kind: "other" }], "social.near"), tx(K(3), NOW - 4 * DAY, [{ kind: "other" }], "app.example.near")],
    }));
    expect(r.status).toBe("clean");
    expect(r.summary).toBe(HEALTH_TEXT.clean);
    expect(r.red).toBe(false);
    expect(r.keys.find((k) => k.publicKey === K(1))!.probableWalletKey).toBe(true);
    expect(r.keys.find((k) => k.publicKey === K(1))!.uses).toBe(17);
  });

  it("any-method app key with no gas limit goes on the tidy-up list: CLEAN, not flagged", async () => {
    const r = await run(src({ keys: [FA(1), FC(2, "social.near", [], null)], hist: [tx(K(2), NOW - DAY, [{ kind: "other" }], "social.near")] }));
    expect(r.status).toBe("clean");
    expect(r.summary).toBe("No warning signs found. 1 key you can tidy up.");
    expect(r.red).toBe(false);
    expect(r.counts).toMatchObject({ flagged: 0, tidy: 1 });
    const k = r.keys.find((x) => x.publicKey === K(2))!;
    expect(k.tidy).toBe(true);
    expect(k.flags.map((f) => [f.level, f.text])).toEqual([["tidy", "This app key can call any method on social.near."], ["tidy", "No spending limit on gas fees."]]);
  });

  it("an app key unused for 6+ months: tidy-up with months", async () => {
    const r = await run(src({ keys: [FA(1), FC(2, "social.near")], recs: [rec(2, false, NOW - 400 * DAY)] }));
    expect(r.status).toBe("clean");
    expect(r.keys.find((x) => x.publicKey === K(2))!.flags).toEqual([{ level: "tidy", code: "UNUSED", text: "Not used in 13 months; you can remove it." }]);
  });

  it("Hammed's testnet shape (one full key + an any-method guest-book key): CLEAN, ready-to-sign removal for the app key only", async () => {
    const r = await accountHealth({ account: "me.testnet" }, src({ keys: [FA(1, "120000000000004"), FC(2, "guestbook.near-examples.testnet", [], "250000000000000000000000")] }), { now: NOW, retryDelayMs: 0 });
    expect(r.status).toBe("clean");
    const app = r.keys.find((k) => k.publicKey === K(2))!;
    const full = r.keys.find((k) => k.publicKey === K(1))!;
    expect(full.remove).toBeUndefined();
    expect(app.remove).toMatchObject({
      accountId: "me.testnet", networkId: "testnet", publicKey: K(2), kind: "app",
      action: { type: "DeleteKey", params: { publicKey: K(2) } },
      nearMcp: { tool: "account_delete_access_keys", args: { accountId: "me.testnet", networkId: "testnet", publicKey: K(2) } },
      nearCli: `near account delete-keys me.testnet public-keys ${K(2)} network-config testnet sign-with-keychain send`,
    });
    expect(app.remove!.links.meteor).toContain("&callback_url=https%3A%2F%2Ftestnet.nearblocks.io%2Faddress%2Fme.testnet");
    const req = parseTxRequest(app.remove!.links.meteor);
    expect(req.transactions[0]).toMatchObject({ signerId: "me.testnet", receiverId: "me.testnet", actions: [{ type: "DeleteKey", publicKey: K(2) }] });
  });

  it("several old full-access keys (like a seed-phrase backup) are not flagged", async () => {
    const keys = [1, 2, 3, 4, 5, 6].map((n) => FA(n, n === 1 ? "21" : "0"));
    const r = await run(src({ keys, recs: [1, 2, 3, 4, 5, 6].map((n) => rec(n, true, NOW - (900 - n * 100) * DAY)), hist: [tx(K(1), NOW - 300 * DAY, [{ kind: "other" }])] }));
    expect(r.status).toBe("clean");
    expect(r.keys.filter((k) => k.flags.length)).toEqual([]);
    expect(r.keys.filter((k) => k.probableWalletKey).map((k) => k.publicKey)).toEqual([K(1)]);
  });

  it("a new account made with two full-access keys minutes apart is not flagged", async () => {
    const add = tx(K(1), NOW - 2 * DAY + 60_000, [{ kind: "addKey", publicKey: K(2), fullAccess: true }]);
    const r = await run(src({ keys: [FA(1), FA(2)], recs: [rec(1, true, NOW - 2 * DAY), rec(2, true, add.timestampMs, add.hash)], hist: [add] }));
    expect(r.status).toBe("clean");
  });
});

describe("account health: red needs evidence", () => {
  it("a full-access key added 3 days ago by another, older key: danger and move-funds advice", async () => {
    const add = tx(K(1), NOW - 3 * DAY, [{ kind: "addKey", publicKey: K(9), fullAccess: true }]);
    const r = await run(src({ keys: [FA(1), FA(9)], recs: [rec(1, true, NOW - 500 * DAY), rec(9, true, add.timestampMs, add.hash)], hist: [add] }));
    expect(r.status).toBe("danger");
    expect(r.summary).toBe(HEALTH_TEXT.danger);
    expect(r.red).toBe(true);
    expect(r.moveFundsNow).toBe(true);
    expect(r.advice).toBe(HEALTH_TEXT.moveFunds);
    const k = r.keys[0]!;
    expect(k.publicKey).toBe(K(9));
    expect(k.flags[0]!.text).toMatch(/^Full control key you may not know\. Added \d+ Oct 2026\. Whoever holds it can move all your funds\.$/);
    expect(k.flags[0]!.why).toBe("Added 3 days ago by another key of this account.");
    expect(k.probableWalletKey).toBe(false);
    expect(r.keys.find((x) => x.publicKey === K(1))!.probableWalletKey).toBe(true);
  });

  it("a recent full-access key on an account with only that key is not flagged", async () => {
    const r = await run(src({ keys: [FA(1)], recs: [rec(1, true, NOW - DAY)] }));
    expect(r.status).toBe("clean");
  });

  it("a key that removed 2 full-access keys and sent funds out within the hour: red", async () => {
    const t = NOW - 100 * DAY;
    const del = tx(K(1), t, [{ kind: "deleteKey", publicKey: K(5) }, { kind: "deleteKey", publicKey: K(6) }]);
    const send = tx(K(1), t + 5 * 60_000, [{ kind: "transfer", depositYocto: "5000000000000000000000000" }], "thief.near");
    const r = await run(src({
      keys: [FA(1), FA(2)], balance: 40,
      recs: [rec(1, true, NOW - 900 * DAY), rec(2, true, NOW - 900 * DAY), rec(5, true, NOW - 900 * DAY, null, t, del.hash), rec(6, true, NOW - 900 * DAY, null, t, del.hash)],
      hist: [send, del],
    }));
    expect(r.status).toBe("danger");
    expect(r.keys[0]!.flags[0]!.why).toBe("It removed 2 other full control keys within an hour and sent funds out.");
  });

  it("removing two old app keys yourself is not a takeover", async () => {
    const t = NOW - 10 * DAY;
    const del = tx(K(1), t, [{ kind: "deleteKey", publicKey: K(5) }, { kind: "deleteKey", publicKey: K(6) }]);
    const r = await run(src({ keys: [FA(1)], recs: [rec(5, false, NOW - 900 * DAY, null, t, del.hash), rec(6, false, NOW - 900 * DAY, null, t, del.hash)], hist: [del] }));
    expect(r.status).toBe("clean");
  });

  it("a new key added by another key, then a send minutes later, account left empty: red (drainer signs)", async () => {
    const t = NOW - 300 * DAY;
    const add = tx(K(2), t, [{ kind: "addKey", publicKey: K(9), fullAccess: true }]);
    const send = tx(K(9), t + 60_000, [{ kind: "transfer", depositYocto: "9000000000000000000000000" }], "dolbabob.near");
    const r = await run(src({ keys: [FA(2), FA(9, "1")], balance: 0.01, recs: [rec(2, true, t - 400 * DAY), rec(9, true, t, add.hash)], hist: [send, add] }));
    expect(r.status).toBe("danger");
    expect(r.keys[0]!.flags[0]!.why).toBe("It sent funds out 1 min after taking control, and the account was left nearly empty.");
  });

  it("an app key for a brand-new contract with little history: LOOK AGAIN (amber), not red, not 'someone else controls it'", async () => {
    const r = await run(src({
      keys: [FA(1), FC(2, "fresh-drop.near")],
      hist: [tx(K(2), NOW - DAY, [{ kind: "other" }], "fresh-drop.near")],
      over: {
        viewAccount: async (_n, a) => (a === ME ? acct(50) : a === "fresh-drop.near" ? acct(5, "9".repeat(44)) : null),
        accountCreated: async (_n, a) => (a === "fresh-drop.near" ? NOW - 5 * DAY : null),
        txCount: async () => 40,
      },
    }));
    expect(r.status).toBe("attention");
    expect(r.red).toBe(false);
    expect(r.counts.flagged).toBe(1);
    expect(r.moveFundsNow).toBe(false);
    expect(r.keys[0]!.flags[0]).toMatchObject({ level: "amber", code: "RISKY_CONTRACT", why: HEALTH_TEXT.riskyContractWhy, text: "App key for a risky contract (fresh-drop.near). It is new or linked to known drainers." });
  });
});

describe("account health: dates and failures", () => {
  it("reads the add height and use count from the nonce", () => {
    expect(readNonce("221452907000012")).toEqual({ addHeight: 221452907, uses: 12 });
    expect(readNonce("134")).toEqual({ addHeight: null, uses: 134 });
  });

  it("dates a key from its nonce height when no indexer knows it, else 'unknown'", async () => {
    const r = await run(src({ keys: [FA(1, "200000000000003")], over: { keyRecords: async () => [], blockTimeMs: async (_n, hh) => (hh === 200000000 ? NOW - 30 * DAY : null) } }));
    expect(r.keys[0]).toMatchObject({ addedFrom: "nonce", uses: 3 });
    expect(r.keys[0]!.addedAt).toBe(new Date(NOW - 30 * DAY).toISOString());
    const u = await run(src({ keys: [FA(1, "200000000000003")], over: { keyRecords: async () => { throw new Error("down"); }, blockTimeMs: async () => { throw new Error("down"); } } }));
    expect(u.keys[0]).toMatchObject({ addedAt: null, addedFrom: null });
    expect(HEALTH_TEXT.unknownFull(null)).toBe("Full control key you may not know. Added: unknown. Whoever holds it can move all your funds.");
  });

  it("no such account, a failed key list, and a non-account", async () => {
    expect((await run(src({ keys: null }))).summary).toBe("This account doesn't exist on NEAR mainnet.");
    const f = await run(src({ keys: [], over: { accessKeys: async () => { throw new Error("rpc down"); } } }));
    expect(f.status).toBe("could-not-check");
    await expect(run(src({ keys: [] }), "hello world!")).rejects.toThrow(/isn't a NEAR account/);
  });

  it("history down: still answers, with a note", async () => {
    const r = await run(src({ keys: [FA(1)], over: { signedTxs: async () => { throw new Error("down"); } } }));
    expect(r.status).toBe("clean");
    expect(r.notes).toContain(HEALTH_TEXT.noHistory);
  });

  it("history blinks once: one quiet retry, no note", async () => {
    let n = 0;
    const r = await run(src({ keys: [FA(1)], over: { signedTxs: async () => { if (n++ === 0) throw new Error("blink"); return []; } } }));
    expect(n).toBe(2);
    expect(r.notes).not.toContain(HEALTH_TEXT.noHistory);
    expect(r.sources.find((s) => s.source.startsWith("fastnear:signed:") && !s.ok)!.optional).toBe(true);
  });

  it("the key list blinks once: retried, still answers", async () => {
    let n = 0;
    const r = await run(src({ keys: [], over: { accessKeys: async () => { if (n++ === 0) throw new Error("blink"); return [FA(1)]; } } }));
    expect(r.status).toBe("clean");
  });
});

describe("remove-key links (unsigned)", () => {
  it("builds one DeleteKey for the account, Meteor always, MyNearWallet on mainnet only", () => {
    const m = deleteKeyLinks("mainnet", ME, K(2), { walletKey: K(1) });
    expect(m.mynearwallet).toMatch(/^https:\/\/app\.mynearwallet\.com\/sign\?transactions=/);
    const req = parseTxRequest(m.meteor);
    expect(req.network).toBe("mainnet");
    expect(req.transactions).toHaveLength(1);
    expect(req.transactions[0]).toMatchObject({ signerId: ME, receiverId: ME, actions: [{ type: "DeleteKey", publicKey: K(2) }] });
    expect(m.confirm).toBe(`Your wallet will open and ask you to sign one change: delete this key. Gideon never sees your keys. Check the key shown in your wallet matches ${K(2).slice(8, 14)}…${K(2).slice(-4)}.`);
    const t = deleteKeyLinks("testnet", "me.testnet", K(2));
    expect(t.mynearwallet).toBeNull();
    expect(t.meteor).toMatch(/^https:\/\/wallet\.meteorwallet\.app\/connect\/testnet\/sign\?transactions=/);
  });

  it("always carries the callback Meteor requires (its parser rejects a link without callback_url)", () => {
    for (const [net, a, home] of [["testnet", "me.testnet", "https://testnet.nearblocks.io/address/me.testnet"], ["mainnet", ME, "https://nearblocks.io/address/me.near"]] as const) {
      const l = deleteKeyLinks(net, a, K(2));
      const q = new URL(l.meteor).searchParams;
      // Meteor: z.object({ callback_url: z.string().min(2), transactions: z.string().min(2) })
      expect(q.get("callback_url")).toBe(home);
      expect(q.get("transactions")!.length).toBeGreaterThan(2);
      expect(q.get("transactions")).toBe(l.transaction);
      if (l.mynearwallet) expect(new URL(l.mynearwallet).searchParams.get("callbackUrl")).toBe(home);
    }
    const own = deleteKeyLinks("testnet", "me.testnet", K(2), { callbackUrl: "https://example.org/keys?account=me.testnet" });
    expect(new URL(own.meteor).searchParams.get("callback_url")).toBe("https://example.org/keys?account=me.testnet");
    expect(removeKeyPlan("testnet", "me.testnet", K(2)).links.callbackUrl).toBe("https://testnet.nearblocks.io/address/me.testnet");
  });
});
