import { describe, expect, it } from "vitest";
import { encodeTransaction, toBase64, type TxRequest } from "../src/tx/decode.js";
import { checkTransaction } from "../src/tx/check.js";
import type { ChainTx, Sources } from "../src/types.js";
import { NOW, acct, empty, fake } from "./helpers.js";

/*
 * 0.3.3: a function-call key granted to a contract (AddKey, or a wallet login with contract_id)
 * gets the T2 new/unfamiliar check and the R18 drained-wallet check. Well-known contracts stay
 * unflagged. A failed lookup is never green.
 */

const KEY = "ed25519:DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847";
const KEY2 = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp";
const DAY = 86_400_000;
const CODE = "8".repeat(44);
const opts = { now: NOW, drainerTimeoutMs: 2000 };
const b64 = (t: Omit<TxRequest, "publicKey"> & { signerId: string }) => toBase64(encodeTransaction({ publicKey: KEY, ...t }));
const fcKey = (contract: string, signer = "me.near") =>
  b64({ signerId: signer, receiverId: signer, actions: [{ type: "AddKey", publicKey: KEY2, fullAccess: false, receiverId: contract, methodNames: ["ft_transfer"] }] });
const json = (signerId: string, receiverId: string, actions: unknown[]) => ({ signerId, receiverId, actions });
const codes = (r: { findings: { code: string }[] }) => r.findings.map((x) => x.code);
const created = (map: Record<string, number>): Partial<Sources> => ({ accountCreated: async (_n, a) => (a in map ? { createdMs: map[a]!, indexed: true } : null) });
const live = (over: Partial<Sources> = {}) =>
  empty({ viewAccount: async (_n, a) => acct(3, a === "me.near" ? "11111111111111111111111111111111" : CODE), sentCount: async () => 0, ...over });

describe("0.3.3: function-call key to a strange contract", () => {
  it("well-known contract (wrap.near) stays SAFE", async () => {
    const r = await checkTransaction({ request: fcKey("wrap.near"), network: "mainnet" }, live(), opts);
    expect(r.verdict).toBe("SAFE");
    expect(codes(r)).not.toContain("UNFAMILIAR_CONTRACT_KEY");
    expect(codes(r)).not.toContain("NEW_CONTRACT_KEY");
  });

  it("an old, not-well-known contract is LOOK AGAIN", async () => {
    const r = await checkTransaction({ request: fcKey("app.near"), network: "mainnet" }, live({
      ...created({ "app.near": NOW - 400 * DAY }),
      txCount: async () => 50_000,
    }), opts);
    expect(r.verdict).toBe("ATTENTION");
    expect(r.headline).toMatchObject({
      rule: "T2",
      code: "UNFAMILIAR_CONTRACT_KEY",
      title: "This gives a key to an unfamiliar contract (app.near).",
    });
    expect(r.headline!.detail).toContain("function-call key");
  });

  it("a new contract with little history is LOOK AGAIN, with the new-contract wording", async () => {
    const r = await checkTransaction({ request: fcKey("evil-new.near"), network: "mainnet" }, live({
      ...created({ "evil-new.near": NOW - 2 * DAY }),
      txCount: async () => 8,
    }), opts);
    expect(r.verdict).toBe("ATTENTION");
    expect(r.headline).toMatchObject({
      rule: "T2",
      code: "NEW_CONTRACT_KEY",
      title: "This gives a key to a new, unfamiliar contract (evil-new.near).",
    });
  });

  it("a failed contract lookup is COULD_NOT_CHECK, never green", async () => {
    const r = await checkTransaction({ request: fcKey("app.near"), network: "mainnet" }, fake(), opts);
    expect(r.verdict).not.toBe("SAFE");
    expect(r.findings.some((x) => x.code === "CONTRACT_UNKNOWN" && x.status === "COULD_NOT_CHECK")).toBe(true);
  });

  it("a MyNearWallet function-call sign-in to an unfamiliar contract is look again", async () => {
    const r = await checkTransaction({
      request: `https://app.mynearwallet.com/login/?contract_id=app.near&public_key=${KEY2}&success_url=https://s.example`,
      network: "mainnet",
    }, live({ ...created({ "app.near": NOW - 400 * DAY }), txCount: async () => 50_000 }), opts);
    expect(r.verdict).toBe("ATTENTION");
    expect(codes(r)).toContain("UNFAMILIAR_CONTRACT_KEY");
    expect(r.signIn).toMatchObject({ fullAccess: false, contractId: "app.near" });
  });

  it("a function-call key to a drainer-linked contract is BLOCKED", async () => {
    const T0 = Date.parse("2026-10-29T10:00:00Z");
    const MIN = 60_000;
    const to = "collector.near";
    const tx = (signer: string, key: string, receiver: string, at: number, height: number, actions: ChainTx["actions"]): ChainTx =>
      ({ hash: `h${signer}${height}`, signer, signerKey: key, receiver, timestampMs: at, blockHeight: height, actions });
    const victim = (name: string) => {
      const add = tx(name, `old-${name}`, name, T0 - MIN, 100, [{ kind: "addKey", publicKey: `new-${name}`, fullAccess: true }]);
      const drain = tx(name, `new-${name}`, to, T0, 160, [{ kind: "transfer", depositYocto: "1000" }]);
      return { name, drain, history: [drain, add] };
    };
    const vs = [victim("a.near"), victim("b.near")];
    const s = live({
      viewAccount: async (_n, a) => (a === "me.near" ? acct(50) : a === to ? acct(30, CODE) : vs.some((v) => v.name === a) ? acct(0.05) : acct(3, CODE)),
      inboundTxs: async (_n, a) => a === to ? { total: 2, txs: vs.map((v) => v.drain) } : { total: 0, txs: [] },
      signedTxsUpTo: async (_n, a, h) => (vs.find((v) => v.name === a)?.history ?? []).filter((x) => x.blockHeight <= h),
    });
    const r = await checkTransaction({ request: fcKey(to), network: "mainnet" }, s, opts);
    expect(r.verdict).toBe("BLOCKED");
    expect(codes(r)).toContain("DRAINER_LINKED");
  });

  it("a failed drained-wallet check on a function-call key grant is never green", async () => {
    // wrap.near is well-known, so T2 does not flag it; R18 still runs and must fail closed.
    const r = await checkTransaction({ request: fcKey("wrap.near"), network: "mainnet" }, live({
      inboundTxs: async () => { throw new Error("indexer down"); },
      signedTxsUpTo: async () => [],
    }), opts);
    expect(r.verdict).not.toBe("SAFE");
    expect(codes(r)).toContain("DRAINER_UNKNOWN");
  });

  it("a function-call on a well-known contract is still not flagged as a key grant", async () => {
    // Don't change T2 for ordinary calls: only AddKey / sign-in grants use the new wording.
    const r = await checkTransaction({
      request: json("me.near", "wrap.near", [{ type: "FunctionCall", params: { methodName: "near_deposit", args: {}, gas: "1", deposit: "0" } }]),
      network: "mainnet",
    }, live(), opts);
    expect(r.verdict).toBe("SAFE");
    expect(codes(r)).not.toContain("UNFAMILIAR_CONTRACT_KEY");
  });
});
