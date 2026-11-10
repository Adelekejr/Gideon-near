import { describe, expect, it } from "vitest";
import { DrainerCache, checkDrainer, drainedBy, drainerCheck, drainerFailedFinding, drainerSkippedByUserFinding, withDrainer } from "../src/drainer.js";
import type { ChainTx, Sources } from "../src/types.js";
import { acct, empty, run } from "./helpers.js";

const T0 = Date.parse("2026-10-29T10:00:00Z");
const MIN = 60_000;
let n = 0;
const tx = (signer: string, key: string, receiver: string, at: number, height: number, actions: ChainTx["actions"]): ChainTx =>
  ({ hash: `h${++n}`, signer, signerKey: key, receiver, timestampMs: at, blockHeight: height, actions });
const send = (yocto = "1000") => [{ kind: "transfer" as const, depositYocto: yocto }];
const addFull = (k: string) => [{ kind: "addKey" as const, publicKey: k, fullAccess: true }];

/** A victim: old key adds new key `minutes` before the new key sends everything to `to`. */
function victim(name: string, to: string, minutes: number, at: number) {
  const h = 1000 + at / MIN;
  const add = tx(name, `old-${name}`, name, at - minutes * MIN, h - minutes * 60, addFull(`new-${name}`));
  const drain = tx(name, `new-${name}`, to, at, h, send());
  return { name, drain, history: [drain, add], left: 0.05 };
}
function normal(name: string, to: string, at: number) {
  const s = tx(name, `k-${name}`, to, at, 1000 + at / MIN, send());
  return { name, drain: s, history: [s, tx(name, `k-${name}`, "x.near", at - 3 * 86_400_000, 1, send())], left: 12 };
}
type Sender = ReturnType<typeof victim>;

function sources(to: string, senders: Sender[], over: Partial<Sources> = {}, toBalance = 30): Sources {
  return empty({
    viewAccount: async (_n, a) => (a === to ? acct(toBalance) : (() => { const s = senders.find((x) => x.name === a); return s ? acct(s.left) : null; })()),
    inboundTxs: async () => ({ total: senders.length, txs: senders.map((s) => s.drain).sort((a, b) => b.timestampMs - a.timestampMs) }),
    signedTxsUpTo: async (_n, a, h) => (senders.find((x) => x.name === a)?.history ?? []).filter((x) => x.blockHeight <= h),
    ...over,
  });
}
const TO = "collector.near";
const check = (s: Sources, extra = {}) => drainerCheck({ to: TO, network: "mainnet", ...extra }, s);

describe("R18 drained wallets swept into the recipient", () => {
  it("2+ drained senders → BLOCKED, naming each one", async () => {
    const x = await check(sources(TO, [victim("a.near", TO, 1, T0), victim("b.near", TO, 10, T0 - MIN), normal("c.near", TO, T0 - 2 * MIN)]));
    expect(x).toMatchObject({ rule: "R18", status: "BLOCKED", code: "DRAINER_COLLECTOR", title: "Funds from hacked wallets were swept into this address" });
    expect(x.evidence?.[0].value).toBe("2 accounts were swept into this address minutes after someone took control of them");
    expect(x.evidence?.[1]).toMatchObject({ label: "a.near", value: "new full-access key added 1 min before it sent here; left with 0.05 NEAR" });
    expect(x.evidence?.[1].url).toMatch(/^https:\/\/nearblocks\.io\/txns\//);
  });

  it("exactly 1 → look again", async () => {
    const x = await check(sources(TO, [victim("a.near", TO, 3, T0), normal("c.near", TO, T0 - MIN)]));
    expect(x).toMatchObject({ status: "ATTENTION", code: "DRAINED_SENDER" });
  });

  it("normal senders → PASS that doesn't vouch for the address", async () => {
    const x = await check(sources(TO, [normal("c.near", TO, T0), normal("d.near", TO, T0 - MIN)]));
    expect(x.status).toBe("PASS");
    expect(x.detail).toContain("doesn't vouch");
  });

  it("strict: key rotation by its owner (sender keeps funds) isn't a drain", () => {
    const v = victim("a.near", TO, 1, T0);
    expect(drainedBy(v.drain, v.history, acct(5), 60 * MIN)).toBeNull();
    expect(drainedBy(v.drain, v.history, acct(0.05), 60 * MIN)).toEqual({ minutesAfterKey: 1 });
    expect(drainedBy(v.drain, v.history, null, 60 * MIN)).toEqual({ minutesAfterKey: 1 }); // deleted afterwards
  });

  it("strict: key added long before, a function-call key, or used before the transfer don't count", () => {
    const old = victim("a.near", TO, 90, T0);
    expect(drainedBy(old.drain, old.history, acct(0), 60 * MIN)).toBeNull();
    const fc = victim("b.near", TO, 1, T0);
    (fc.history[1].actions[0] as { fullAccess: boolean }).fullAccess = false;
    expect(drainedBy(fc.drain, fc.history, acct(0), 60 * MIN)).toBeNull();
    const used = victim("c.near", TO, 5, T0);
    used.history.splice(1, 0, tx("c.near", "new-c.near", "y.near", T0 - 2 * MIN, used.drain.blockHeight - 120, send()));
    expect(drainedBy(used.drain, used.history, acct(0), 60 * MIN)).toBeNull();
    const other = victim("e.near", TO, 5, T0);
    other.history.splice(1, 0, tx("e.near", "new-e.near", "e.near", T0 - 2 * MIN, other.drain.blockHeight - 120, [{ kind: "other" }]));
    expect(drainedBy(other.drain, other.history, acct(0), 60 * MIN)).toBeNull();
    const self = tx("d.near", "k", "d.near", T0 - MIN, 5, addFull("k"));
    expect(drainedBy(tx("d.near", "k", TO, T0, 6, send()), [self], acct(0), 60 * MIN)).toBeNull();
  });

  it("new key that first deletes the owner's old keys, then sweeps: counts", async () => {
    const v = victim("a.near", TO, 4, T0);
    const h = v.drain.blockHeight;
    v.history.splice(1, 0, ...["k1", "k2", "k2"].map((k, i) => tx("a.near", "new-a.near", "a.near", T0 - (3 - i) * MIN, h - 100 + i, [{ kind: "deleteKey" as const, publicKey: `old-${k}` }])));
    expect(drainedBy(v.drain, v.history, acct(0.05), 60 * MIN)).toEqual({ minutesAfterKey: 4, deletedOldKeys: true });
    const w = victim("b.near", TO, 2, T0 - MIN);
    w.history.splice(1, 0, tx("b.near", "new-b.near", "b.near", T0 - 2 * MIN, w.drain.blockHeight - 10, [{ kind: "deleteKey" as const, publicKey: "old-b.near" }]));
    const x = await check(sources(TO, [v, w]));
    expect(x).toMatchObject({ status: "BLOCKED", code: "DRAINER_COLLECTOR" });
    expect(x.evidence?.[1].value).toBe("new full-access key added 4 min before it sent here; it first removed the owner's other keys; left with 0.05 NEAR");
  });

  it("takeover by a dormant key: deletes 2+ of the owner's keys minutes before sweeping", () => {
    const at = T0, h = 50_000;
    const add = tx("d.near", "old-d", "d.near", at - 90 * 86_400_000, 10, addFull("evil"));
    const own = tx("d.near", "old-d", "y.near", at - 80 * 86_400_000, 20, send());
    const dels = ["o1", "o2", "o3"].map((k, i) => tx("d.near", "evil", "d.near", at - (6 - i) * MIN, h - 10 + i, [{ kind: "deleteKey" as const, publicKey: k }]));
    const drain = tx("d.near", "evil", TO, at, h, send());
    expect(drainedBy(drain, [drain, ...dels, own, add], acct(0.02), 60 * MIN)).toEqual({ minutesAfterKey: 6, deletedOldKeys: true, takeover: { keysRemoved: 3, atLeast: false } });
    // The same key used weeks earlier: not dormant.
    const earlier = tx("d.near", "evil", "z.near", at - 20 * 86_400_000, 30, send());
    expect(drainedBy(drain, [drain, ...dels, earlier, own, add], acct(0.02), 60 * MIN)).toBeNull();
    // Only one key removed, or funds left: not counted.
    expect(drainedBy(drain, [drain, dels[0], own, add], acct(0.02), 60 * MIN)).toBeNull();
    expect(drainedBy(drain, [drain, ...dels, own, add], acct(3), 60 * MIN)).toBeNull();
    // History that is all burst, no addition in sight: only a big lock-out (10+ keys) counts.
    expect(drainedBy(drain, [drain, ...dels], acct(0.02), 60 * MIN)).toBeNull();
    const many = Array.from({ length: 12 }, (_, i) => tx("d.near", "evil", "d.near", at - (20 - i) * MIN, h - 30 + i, [{ kind: "deleteKey" as const, publicKey: `m${i}` }]));
    expect(drainedBy(drain, [drain, ...many], acct(0.02), 60 * MIN)).toMatchObject({ takeover: { keysRemoved: 12, atLeast: true } });
  });

  it("reads a sender's history only when it was left nearly empty, and further back only for a burst", async () => {
    const asked: number[] = [];
    const rich = normal("r.near", TO, T0);
    const many = Array.from({ length: 25 }, (_, i) => tx("d.near", "evil", "d.near", T0 - (30 - i) * MIN, 900 + i, [{ kind: "deleteKey" as const, publicKey: `m${i}` }]));
    const drain = tx("d.near", "evil", TO, T0 + MIN, 999, send());
    const add = tx("d.near", "old", "d.near", T0 - 40 * MIN, 800, addFull("evil"));
    const burst = { name: "d.near", drain, history: [drain, ...many.reverse(), add], left: 0.01 };
    const s = sources(TO, [rich, burst]);
    const inner = s.signedTxsUpTo!;
    s.signedTxsUpTo = async (n, a, h, lim) => { asked.push(lim); return (await inner(n, a, h, lim)).slice(0, lim); };
    const x = await check(s);
    expect(asked).toEqual([20, 40]);
    expect(x).toMatchObject({ status: "ATTENTION" });
    expect(x.evidence?.[0].value).toContain("new full-access key added 41 min before it sent here; it first removed the owner's other keys");
  });

  it("skips exchanges: rich, busy, known, or senders with identical balances", async () => {
    const vs = [victim("a.near", TO, 1, T0), victim("b.near", TO, 1, T0 - MIN)];
    expect((await check(sources(TO, vs, {}, 200_000))).code).toBe("BUSY_ACCOUNT");
    expect((await check(sources(TO, vs, { inboundTxs: async () => ({ total: 1_800_000, txs: vs.map((v) => v.drain) }) }))).code).toBe("BUSY_ACCOUNT");
    expect((await drainerCheck({ to: "ccb91e1db61e8d7e1d4ae3e043001140132959a86ee35a548b6563a46284a6ea", network: "mainnet" }, sources(TO, vs))).code).toBe("BUSY_ACCOUNT");
    const deposits = ["p", "q", "r", "s"].map((x) => ({ ...normal(`${x}.near`, TO, T0), left: 0.0675 }));
    expect((await check(sources(TO, [victim("a.near", TO, 1, T0 + MIN), ...deposits]))).code).toBe("BUSY_ACCOUNT");
  });

  it("skips your contacts, your own accounts and the sender", async () => {
    const s = sources(TO, [victim("a.near", TO, 1, T0), victim("b.near", TO, 1, T0 - MIN)]);
    expect((await check(s, { addressBook: [{ account: TO }] })).code).toBe("CONTACT");
    expect((await check(s, { myAccounts: [TO] })).code).toBe("OWN_ACCOUNT");
    expect((await check(s, { from: TO })).code).toBe("OWN_ACCOUNT");
  });

  it("failures and time-outs are COULD_NOT_CHECK (never a pass)", async () => {
    const vs = [victim("a.near", TO, 1, T0)];
    const down = await check(sources(TO, vs, { inboundTxs: async () => { throw new Error("HTTP 500"); } }));
    expect(down).toMatchObject({ status: "COULD_NOT_CHECK", code: "FAILED" });
    const slow = await drainerCheck({ to: TO, network: "mainnet" }, sources(TO, vs, { inboundTxs: () => new Promise(() => {}) }), { timeoutMs: 30 });
    expect(slow).toMatchObject({ status: "COULD_NOT_CHECK", code: "FAILED" });
    expect((await check(empty())).code).toBe("UNAVAILABLE");
  });

  it("looks at 5 senders at most, in parallel", async () => {
    let busy = 0, peak = 0, asked = 0;
    const vs = Array.from({ length: 8 }, (_, i) => ({ ...normal(`n${i}.near`, TO, T0 - i * MIN), left: 0.01 + i / 1000 }));
    const s = sources(TO, vs);
    const inner = s.signedTxsUpTo!;
    s.signedTxsUpTo = async (...a) => { asked++; busy++; peak = Math.max(peak, busy); await new Promise((r) => setTimeout(r, 5)); busy--; return inner(...a); };
    expect((await check(s)).status).toBe("PASS");
    expect(asked).toBe(5);
    expect(peak).toBe(5);
  });

  it("withDrainer updates the verdict, headline and receipt; SKIPPED changes nothing; FAILED is look again", async () => {
    const r = await run({ to: "collector.testnet" }, empty({ viewAccount: async () => acct(30) }));
    expect(r.verdict).toBe("SAFE");
    const s = sources("collector.testnet", [victim("a.testnet", "collector.testnet", 1, T0), victim("b.testnet", "collector.testnet", 2, T0 - MIN)]);
    const x = await drainerCheck({ to: "collector.testnet", network: "testnet" }, s);
    const m = await withDrainer(r, x);
    expect(m.verdict).toBe("BLOCKED");
    expect(m.headline?.rule).toBe("R18");
    expect(m.receipt.sha256).not.toBe(r.receipt.sha256);
    const k = await withDrainer(r, { rule: "R18", status: "SKIPPED", code: "CONTACT", title: "", detail: "" });
    expect(k.verdict).toBe(r.verdict);
    expect(k.headline).toEqual(r.headline);
    const failed = await withDrainer(r, drainerFailedFinding());
    expect(failed.verdict).toBe("ATTENTION");
    expect(failed.headline?.code).toBe("FAILED");
    const opted = await withDrainer(r, drainerSkippedByUserFinding());
    expect(opted.verdict).toBe("SAFE");
    expect(opted.findings.some((f) => f.code === "SKIPPED_BY_USER")).toBe(true);
  });

  it("cache keeps answers, not failures", async () => {
    const c = new DrainerCache(60_000);
    let calls = 0;
    const input = { to: TO, network: "mainnet" as const };
    const pass = async () => { calls++; return { rule: "R18" as const, status: "PASS" as const, code: "NO_DRAINED_SENDERS", title: "", detail: "" }; };
    await c.get(input, pass); await c.get(input, pass);
    expect(calls).toBe(1);
    const fail = async () => { calls++; return drainerFailedFinding(); };
    await c.get({ ...input, to: "x.near" }, fail); await c.get({ ...input, to: "x.near" }, fail);
    expect(calls).toBe(3);
  });

  it("a contact added after a cached BLOCK is skipped at once (offline skips come before the cache)", async () => {
    const c = new DrainerCache(60_000);
    const s = sources(TO, [victim("a.near", TO, 1, T0), victim("b.near", TO, 1, T0 - MIN)]);
    expect((await drainerCheck({ to: TO, network: "mainnet" }, s, {}, c)).status).toBe("BLOCKED");
    expect((await drainerCheck({ to: TO, network: "mainnet", addressBook: [{ account: TO }] }, s, {}, c)).code).toBe("CONTACT");
  });

  it("checkDrainer: merges into a SAFE result, leaves an already-BLOCKED one alone", async () => {
    const to = "collector.testnet";
    const s = sources(to, [victim("a.testnet", to, 1, T0), victim("b.testnet", to, 2, T0 - MIN)]);
    const r = await run({ to }, empty({ viewAccount: async () => acct(30) }));
    const m = await checkDrainer(r, s);
    expect(m.verdict).toBe("BLOCKED");
    // A completed check (here, a block) is not optional: only an intentional skip is.
    expect(m.sources.find((x) => x.source === "R18:drained-wallets")?.optional).toBe(false);
    let asked = 0;
    const again = await checkDrainer(m, { ...s, inboundTxs: async (...a) => { asked++; return s.inboundTxs!(...a); } });
    expect(asked).toBe(0);
    expect(again).toBe(m);
  });

  it("checkDrainer: a failed lookup on a SAFE result becomes ATTENTION, never stays SAFE", async () => {
    const r = await run({ to: "collector.testnet" }, empty({ viewAccount: async () => acct(30) }));
    expect(r.verdict).toBe("SAFE");
    const m = await checkDrainer(r, empty({ inboundTxs: async () => { throw new Error("indexer down"); }, signedTxsUpTo: async () => [] }), {}, { timeoutMs: 200 });
    expect(m.verdict).toBe("ATTENTION");
    expect(m.findings.find((f) => f.rule === "R18")).toMatchObject({ code: "FAILED", status: "COULD_NOT_CHECK" });
  });
});
