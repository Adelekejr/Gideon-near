import { describe, expect, it } from "vitest";
import { check } from "../src/engine.js";
import { withTimeout, TimeoutError } from "../src/time.js";
import type { CheckInput, CheckOptions, Sources } from "../src/types.js";
import { acct, empty, find, NOW } from "./helpers.js";

/** A source that never answers (a hung fetch, a dead endpoint). */
const hang = (): Promise<never> => new Promise(() => {});
const live = (over: Partial<Sources> = {}) => empty({ viewAccount: async () => ({ ...acct(10), blockHeight: 2000 }), ...over });
const timed = async (input: Partial<CheckInput> & { to: string }, s: Sources, opts: CheckOptions) => {
  const t0 = Date.now();
  const r = await check({ network: "testnet", ...input }, s, { now: NOW, ...opts });
  return { r, ms: Date.now() - t0 };
};

describe("withTimeout", () => {
  it("passes a fast answer through and rejects a slow one with a TimeoutError", async () => {
    await expect(withTimeout(Promise.resolve(7), 50, "x")).resolves.toBe(7);
    await expect(withTimeout(hang(), 20, "creation date lookup")).rejects.toBeInstanceOf(TimeoutError);
    await expect(withTimeout(hang(), 20, "creation date lookup")).rejects.toThrow("creation date lookup took longer than 0.02 s");
  });
  it("no limit when ms is missing or 0", async () => {
    await expect(withTimeout(Promise.resolve(1), undefined, "x")).resolves.toBe(1);
    await expect(withTimeout(Promise.resolve(1), 0, "x")).resolves.toBe(1);
  });
});

describe("time limits (the in-page card must always resolve)", () => {
  it("a hung account lookup → couldn't check within the per-source limit, never SAFE", async () => {
    const { r, ms } = await timed({ to: "bob.testnet" }, empty({ viewAccount: hang }), { sourceTimeoutMs: 100 });
    expect(ms).toBeLessThan(1000);
    expect(r.verdict).not.toBe("SAFE");
    expect(find(r, "R3")[0].status).toBe("COULD_NOT_CHECK");
    expect(r.account?.exists).toBeNull();
    const call = r.sources.find((c) => c.source.startsWith("rpc-testnet") || c.source.includes("testnet"));
    expect(call).toMatchObject({ ok: false });
    expect(call?.error).toMatch(/took longer than 0.1 s/);
  });

  it("a hung creation-date lookup doesn't hold the verdict: SAFE, 'Creation date unavailable'", async () => {
    const { r, ms } = await timed({ to: "bob.testnet" }, live({ accountCreated: hang }), { sourceTimeoutMs: 3000, optionalBudgetMs: 100 });
    expect(ms).toBeLessThan(1000);
    expect(r.verdict).toBe("SAFE");
    expect(find(r, "R11")[0]).toMatchObject({ status: "PASS", code: "CREATED_UNKNOWN" });
    expect(r.account).toMatchObject({ exists: true, created: "unavailable" });
    expect(r.sources.find((c) => c.source.startsWith("nearblocks"))).toMatchObject({ ok: false, optional: true });
  });

  it("a hung archival dating chain stays inside the optional budget", async () => {
    const unindexed = async () => ({ createdMs: null, indexed: false, indexedHeight: 1000 });
    const { r, ms } = await timed({ to: "fresh.testnet" }, live({ accountCreated: unindexed, accountExistedAt: hang }), { optionalBudgetMs: 150 });
    expect(ms).toBeLessThan(1000);
    expect(find(r, "R11")[0].code).toBe("NEW_ACCOUNT_UNINDEXED");
    expect(r.account?.exists).toBe(true);
  });

  it("the optional budget is shared: a slow date then a slow archive can't add up past it", async () => {
    const slow = <T>(v: T, ms: number) => () => new Promise<T>((res) => setTimeout(() => res(v), ms));
    const { ms } = await timed({ to: "fresh.testnet" },
      live({ accountCreated: slow({ createdMs: null, indexed: false, indexedHeight: 1000 }, 120), accountExistedAt: slow(true, 120) }),
      { optionalBudgetMs: 200 });
    expect(ms).toBeLessThan(600);
  });

  it("the overall deadline caps the whole check even with no per-source limit", async () => {
    const { r, ms } = await timed({ to: "bob.testnet" }, empty({ viewAccount: hang }), { deadlineMs: 150 });
    expect(ms).toBeLessThan(1000);
    expect(r.verdict).not.toBe("SAFE");
    expect(r.findings.some((f) => f.code === "TIMED_OUT" && f.status === "COULD_NOT_CHECK")).toBe(true);
    expect(r.findings.find((f) => f.code === "TIMED_OUT")?.detail).toMatch(/within 0.15 s/);
  });

  it("fast sources are unaffected by the limits", async () => {
    const { r } = await timed({ to: "bob.testnet" }, live({ accountCreated: async () => ({ createdMs: NOW - 400 * 86_400_000, indexed: true, indexedHeight: 1000 }) }),
      { deadlineMs: 6000, sourceTimeoutMs: 3000, optionalBudgetMs: 2000 });
    expect(r.verdict).toBe("SAFE");
    expect(r.account).toMatchObject({ created: "known" });
    expect(r.findings.some((f) => f.code === "TIMED_OUT")).toBe(false);
  });
});
