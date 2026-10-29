import { describe, expect, it, vi } from "vitest";
import type { CheckResult, Sources } from "@gideon/core";
import { sendCheck } from "../src/lib/messages.js";
import { resolveNetwork } from "../src/lib/resolve.js";
import { cachedSources, TtlCache } from "../src/lib/cache.js";
import { cacheable, checkKey, missingOptional } from "../src/lib/runcache.js";
import { LIMITS } from "../src/lib/limits.js";

const hang = (): Promise<never> => new Promise(() => {});
const info = { amountYocto: "1", codeHash: "1".repeat(32), storageUsage: 1 };

describe("limits", () => {
  it("whole check 6 s, each lookup 3 s, creation date never longer than the verdict allows", () => {
    expect(LIMITS.totalMs).toBe(6000);
    expect(LIMITS.sourceMs).toBe(3000);
    expect(LIMITS.optionalMs).toBeLessThanOrEqual(LIMITS.sourceMs);
    expect(LIMITS.sourceMs + LIMITS.optionalMs).toBeLessThanOrEqual(LIMITS.totalMs);
    expect(LIMITS.pageWaitMs).toBeGreaterThan(LIMITS.totalMs);
  });
});

describe("sendCheck never leaves the card on CHECKING", () => {
  const req = { input: { to: "bob.near" }, host: "x" };
  it("a worker that never replies → ok:false after the limit", async () => {
    const t0 = Date.now();
    const r = await sendCheck(req, 80, hang);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/took longer than 0.08 s/);
  });
  it("a worker stopped mid-check (undefined reply) or a thrown send → ok:false", async () => {
    expect(await sendCheck(req, 80, async () => undefined)).toMatchObject({ ok: false, error: "The extension stopped before it answered." });
    expect(await sendCheck(req, 80, async () => { throw new Error("Could not establish connection."); })).toMatchObject({ ok: false });
  });
  it("passes a reply through", async () => {
    const reply = { ok: false as const, error: "x" };
    expect(await sendCheck(req, 80, async () => reply)).toBe(reply);
  });
});

describe("network guess on both networks is time-limited", () => {
  it("one network hangs → answers within the limit, treating it as a failed lookup", async () => {
    const t0 = Date.now();
    const n = await resolveNetwork("auto", undefined, "ab".repeat(32), { viewAccount: async (net) => (net === "testnet" ? hang() : info) }, 80);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(n.network).toBe("mainnet");
  });
});

describe("cache (per account and network, a few minutes)", () => {
  it("two identical lookups in flight share one fetch, and a found account is reused", async () => {
    let t = 0;
    const view = vi.fn(async () => info);
    const s = cachedSources({ viewAccount: view } as unknown as Sources, 1000, () => t);
    await Promise.all([s.viewAccount("mainnet", "a.near"), s.viewAccount("mainnet", "a.near")]);
    await s.viewAccount("mainnet", "a.near");
    expect(view).toHaveBeenCalledTimes(1);
    await s.viewAccount("testnet", "a.near"); // other network = other entry
    expect(view).toHaveBeenCalledTimes(2);
    t = 1001; // expired
    await s.viewAccount("mainnet", "a.near");
    expect(view).toHaveBeenCalledTimes(3);
  });
  it("never keeps a failure or a 'not found'", async () => {
    let fail = true;
    const view = vi.fn(async () => { if (fail) throw new Error("down"); return null; });
    const s = cachedSources({ viewAccount: view } as unknown as Sources, 60_000);
    await expect(s.viewAccount("mainnet", "a.near")).rejects.toThrow("down");
    fail = false;
    expect(await s.viewAccount("mainnet", "a.near")).toBeNull();
    expect(await s.viewAccount("mainnet", "a.near")).toBeNull();
    expect(view).toHaveBeenCalledTimes(3);
  });
  it("creation dates are kept only when there is a date", async () => {
    const created = vi.fn(async () => ({ createdMs: null, indexed: false, indexedHeight: 1 }));
    const s = cachedSources({ viewAccount: async () => info, accountCreated: created } as unknown as Sources, 60_000);
    await s.accountCreated!("mainnet", "a.near");
    await s.accountCreated!("mainnet", "a.near");
    expect(created).toHaveBeenCalledTimes(2);
    created.mockResolvedValue({ createdMs: 5, indexed: true, indexedHeight: 1 } as never);
    await s.accountCreated!("mainnet", "b.near");
    await s.accountCreated!("mainnet", "b.near");
    expect(created).toHaveBeenCalledTimes(3);
  });
  it("TtlCache stays bounded", () => {
    const c = new TtlCache<number>(60_000, Date.now, 3);
    for (let i = 0; i < 10; i++) c.set(String(i), Promise.resolve(i));
    expect(c.size).toBe(3);
  });
});

describe("which finished checks are reused", () => {
  const base = { sources: [{ source: "rpc", ok: true, ms: 1 }], findings: [{ status: "PASS" }] } as unknown as CheckResult;
  it("complete answers only", () => {
    expect(cacheable(base)).toBe(true);
    expect(cacheable({ ...base, sources: [...base.sources, { source: "nearblocks", ok: false, ms: 1, optional: true }] })).toBe(false);
    expect(cacheable({ ...base, findings: [{ status: "COULD_NOT_CHECK" }] } as unknown as CheckResult)).toBe(false);
  });
  it("a missing creation date (only) triggers one quiet refill", () => {
    expect(missingOptional(base)).toBe(false);
    expect(missingOptional({ ...base, sources: [...base.sources, { source: "nearblocks", ok: false, ms: 1, optional: true }] })).toBe(true);
    expect(missingOptional({ ...base, sources: [{ source: "rpc", ok: false, ms: 1 }, { source: "nearblocks", ok: false, ms: 1, optional: true }] })).toBe(false);
  });
  it("cache key covers network, recipient, clipboard and contacts", () => {
    const k = (o: object) => checkKey({ to: "a.near", network: "mainnet", ...o });
    expect(k({})).toBe(k({}));
    expect(k({ network: "testnet" })).not.toBe(k({}));
    expect(k({ clipboard: { copied: "b.near" } })).not.toBe(k({}));
    expect(k({ addressBook: [{ name: "x", address: "a.near" }] })).not.toBe(k({}));
  });
});
