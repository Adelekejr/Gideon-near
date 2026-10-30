import { describe, expect, it } from "vitest";
import { FastNearTx, mergedHistory, liveSources } from "../src/index.js";
import type { Fetch } from "../src/http.js";

const J = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchOf = (h: (url: string, body: any) => Response | Promise<Response>): Fetch =>
  (async (url: any, init: any) => h(String(url), init?.body ? JSON.parse(String(init.body)) : null)) as Fetch;

const tx = (hash: string, signer: string, receiver: string, actions: unknown[], ts: number) =>
  ({ transaction: { hash, signer_id: signer, receiver_id: receiver, actions }, execution_outcome: { block_timestamp: ts } });

describe("FastNEAR transactions API", () => {
  it("reads the newest hashes, then the transactions, with deposits", async () => {
    const calls: string[] = [];
    const fn = new FastNearTx({ fetch: fetchOf((url, body) => {
      calls.push(`${new URL(url).host}${new URL(url).pathname}${body.is_real_signer ? " signer" : ""}`);
      if (url.endsWith("/v0/account")) {
        return J({ account_txs: body.is_real_signer ? [{ transaction_hash: "A" }] : [{ transaction_hash: "A" }, { transaction_hash: "B" }] });
      }
      expect(body.tx_hashes).toEqual(["A", "B"]);
      return J({ transactions: [
        tx("A", "hammed-stampdue.testnet", "ref-finance.testnet", [{ Transfer: { deposit: "100000000000000000000000" } }], 2),
        tx("B", "dust.testnet", "hammed-stampdue.testnet", [{ FunctionCall: { method_name: "x", deposit: "1" } }], 1),
      ] });
    }) });
    const out = await fn.recentTransfers("testnet", "hammed-stampdue.testnet");
    expect(out.map((t) => [t.hash, t.signer, t.receiver, t.depositYocto])).toEqual([
      ["A", "hammed-stampdue.testnet", "ref-finance.testnet", 1e23],
      ["B", "dust.testnet", "hammed-stampdue.testnet", 1],
    ]);
    expect(calls).toContain("tx.test.fastnear.com/v0/account signer");
    expect(calls).toContain("tx.test.fastnear.com/v0/transactions");
  });
  it("no transactions → empty, one call pair", async () => {
    const fn = new FastNearTx({ fetch: fetchOf(() => J({ account_txs: [] })) });
    expect(await fn.recentTransfers("mainnet", "x.near")).toEqual([]);
  });
  it("HTTP errors throw", async () => {
    const fn = new FastNearTx({ fetch: fetchOf(() => new Response("", { status: 500 })) });
    await expect(fn.recentTransfers("testnet", "x.testnet")).rejects.toThrow(/FastNEAR HTTP 500/);
  });
});

describe("merged history", () => {
  const t = (hash: string, ts: number) => ({ hash, signer: "a", receiver: "b", depositYocto: 0, blockTimestampNs: String(ts) });
  it("merges both, dedupes by hash, newest first", async () => {
    const r = await mergedHistory(async () => [t("x", 3), t("y", 2)], async () => [t("y", 2), t("z", 1)]);
    expect(r.map((x) => x.hash)).toEqual(["x", "y", "z"]);
  });
  it("one fails → the other's answer", async () => {
    const r = await mergedHistory(async () => { throw new Error("down"); }, async () => [t("z", 1)]);
    expect(r.map((x) => x.hash)).toEqual(["z"]);
  });
  it("both fail → throws the first error", async () => {
    await expect(mergedHistory(async () => { throw new Error("one"); }, async () => { throw new Error("two"); })).rejects.toThrow(/one|two/);
  });
  it("a slow source doesn't hold the answer past the grace time", async () => {
    const t0 = Date.now();
    const r = await mergedHistory(async () => [t("fast", 1)], () => new Promise((res) => setTimeout(() => res([t("slow", 2)]), 2000)), 100);
    expect(r.map((x) => x.hash)).toEqual(["fast"]);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it("liveSources asks FastNEAR and NearBlocks", async () => {
    const hosts = new Set<string>();
    const s = liveSources({ fetch: fetchOf((url) => {
      hosts.add(new URL(url).host);
      if (url.includes("fastnear.com/v0/account")) return J({ account_txs: [{ transaction_hash: "F" }] });
      if (url.includes("fastnear.com/v0/transactions")) return J({ transactions: [tx("F", "me.testnet", "fresh.testnet", [{ Transfer: { deposit: "5" } }], 9)] });
      return J({ txns: [{ transaction_hash: "N", predecessor_account_id: "me.testnet", receiver_account_id: "old.testnet", actions_agg: { deposit: 1 }, block_timestamp: "1" }] });
    }) });
    const r = await s.recentTransfers("testnet", "me.testnet");
    expect(r.map((x) => x.receiver).sort()).toEqual(["fresh.testnet", "old.testnet"]);
    expect(hosts.has("tx.test.fastnear.com")).toBe(true);
    expect(hosts.has("api-testnet.nearblocks.io")).toBe(true);
  });
  it("an empty, lagging index doesn't cut off the fresh history (the ref-flnance miss)", async () => {
    const r = await mergedHistory(() => new Promise((res) => setTimeout(() => res([t("sent-today", 2)]), 300)), async () => [], 50, 1000);
    expect(r.map((x) => x.hash)).toEqual(["sent-today"]);
  });
  it("when the deep index answers first, the fresh one still gets its longer wait", async () => {
    const r = await mergedHistory(() => new Promise((res) => setTimeout(() => res([t("new", 2)]), 300)), async () => [t("old", 1)], 50, 1000);
    expect(r.map((x) => x.hash)).toEqual(["new", "old"]);
  });
});
