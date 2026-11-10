import { describe, expect, it } from "vitest";
import { ForeignChains, NearBlocks, NearRpc, OneClick, liveSources } from "../src/index.js";
import type { Fetch } from "../src/http.js";

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
const fetchOf = (h: Handler): Fetch => (async (url: any, init: any) => h(String(url), init ?? {})) as Fetch;
const J = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const bytes = (v: unknown) => Array.from(new TextEncoder().encode(JSON.stringify(v)));

describe("NEAR RPC", () => {
  it("view_account → info; UNKNOWN_ACCOUNT → null", async () => {
    const rpc = new NearRpc({ fetch: fetchOf((_u, i) => {
      const p = JSON.parse(String(i.body)).params;
      return p.account_id === "a.testnet"
        ? J({ result: { amount: "10000000000000000000000000", code_hash: "11111111111111111111111111111111", storage_usage: 182, block_height: 275341942 } })
        : J({ error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCOUNT" } } });
    }) });
    expect((await rpc.viewAccount("testnet", "a.testnet"))?.amountYocto).toBe("10000000000000000000000000");
    expect((await rpc.viewAccount("testnet", "a.testnet"))?.blockHeight).toBe(275341942);
    expect(await rpc.viewAccount("testnet", "b.testnet")).toBeNull();
  });
  it("falls back to the next endpoint on 5xx, then throws", async () => {
    const seen: string[] = [];
    const rpc = new NearRpc({ fetch: fetchOf((u) => { seen.push(new URL(u).host); return new Response("", { status: 502 }); }) });
    await expect(rpc.viewAccount("mainnet", "x.near")).rejects.toThrow(/NEAR RPC \(mainnet\) failed/);
    expect(seen).toEqual(["rpc.mainnet.fastnear.com", "free.rpc.fastnear.com"]);
  });
  it("paid RPC adapter: custom URL and headers", async () => {
    let got: any;
    const rpc = new NearRpc({ urls: { mainnet: ["https://paid.example/rpc"] }, headers: { Authorization: "Bearer k" },
      fetch: fetchOf((u, i) => { got = { u, h: i.headers }; return J({ error: { cause: { name: "UNKNOWN_ACCOUNT" } } }); }) });
    await rpc.viewAccount("mainnet", "x.near");
    expect(got.u).toBe("https://paid.example/rpc");
    expect(got.h.Authorization).toBe("Bearer k");
  });
  it("ft_metadata decodes bytes; missing method → null", async () => {
    const rpc = new NearRpc({ fetch: fetchOf((_u, i) => {
      const p = JSON.parse(String(i.body)).params;
      return p.account_id === "wrap.testnet" ? J({ result: { result: bytes({ name: "Wrapped NEAR", symbol: "wNEAR", decimals: 24 }) } })
        : J({ result: { error: "wasm execution failed with error: MethodResolveError(MethodNotFound)" } });
    }) });
    expect((await rpc.ftMetadata("testnet", "wrap.testnet"))?.symbol).toBe("wNEAR");
    expect(await rpc.ftMetadata("testnet", "bob.testnet")).toBeNull();
  });
  it("storage_balance_of null → not registered", async () => {
    const rpc = new NearRpc({ fetch: fetchOf(() => J({ result: { result: bytes(null) } })) });
    expect(await rpc.storageRegistered("testnet", "wrap.testnet", "a.testnet")).toBe(false);
  });
  it("timeout → throws a clear error", async () => {
    const rpc = new NearRpc({ timeoutMs: 20, urls: { testnet: ["https://slow.example"] },
      fetch: ((_u: any, i: any) => new Promise((_r, rej) => i.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as Fetch });
    await expect(rpc.viewAccount("testnet", "a.testnet")).rejects.toThrow(/timed out/);
  });
});

describe("Community flag registry (R10)", () => {
  it("get_flags → flags; missing account or contract → null; junk → throws", async () => {
    const rpc = (answer: unknown) => new NearRpc({ fetch: fetchOf((_u, i) => {
      const p = JSON.parse(String(i.body)).params;
      expect([p.method_name, JSON.parse(atob(p.args_base64))]).toEqual(["get_flags", { account_id: "scam.testnet" }]);
      return J(answer);
    }) });
    const flag = { reporter: "alice.testnet", reason: "dust", at_ms: 1 };
    expect(await rpc({ result: { result: bytes([flag]) } }).communityFlags("testnet", "flags.testnet", "scam.testnet")).toEqual([flag]);
    expect(await rpc({ result: { result: bytes([]) } }).communityFlags("testnet", "flags.testnet", "scam.testnet")).toEqual([]);
    expect(await rpc({ error: { cause: { name: "UNKNOWN_ACCOUNT" } } }).communityFlags("testnet", "flags.testnet", "scam.testnet")).toBeNull();
    expect(await rpc({ result: { error: "wasm execution failed with error: CompilationError(CodeDoesNotExist { account_id: \"flags.testnet\" })" } })
      .communityFlags("testnet", "flags.testnet", "scam.testnet")).toBeNull();
    await expect(rpc({ result: { result: bytes({ nope: 1 }) } }).communityFlags("testnet", "flags.testnet", "scam.testnet")).rejects.toThrow(/unexpected/);
  });
});

describe("other chains", () => {
  const H = "89a46298b5f72a95c3205ec6dfc2e842860f1faf24e701de2ae03418f4126944";
  it("TronGrid: tx found / {} = not found", async () => {
    const found = new ForeignChains({ fetch: fetchOf(() => J({ txID: H, raw_data: { contract: [{ type: "TransferContract", parameter: { value: { amount: 4629000 } } }] } })) });
    expect((await found.tronTx(H))?.summary).toContain("4.629 TRX");
    expect(await new ForeignChains({ fetch: fetchOf(() => J({})) }).tronTx(H)).toBeNull();
  });
  it("Ethereum: null result = not found; error throws", async () => {
    expect(await new ForeignChains({ fetch: fetchOf(() => J({ result: null })) }).ethTx("0x" + H)).toBeNull();
    await expect(new ForeignChains({ fetch: fetchOf(() => J({ error: { message: "limit" } })) }).ethTx("0x" + H)).rejects.toThrow(/limit/);
  });
  it("mempool.space: 404 = not found; 503 throws", async () => {
    expect(await new ForeignChains({ fetch: fetchOf(() => new Response("Transaction not found", { status: 404 })) }).btcTx(H)).toBeNull();
    await expect(new ForeignChains({ fetch: fetchOf(() => new Response("", { status: 503 })) }).btcTx(H)).rejects.toThrow(/503/);
  });
});

describe("1Click (read-only status)", () => {
  it("404 → null; 200 → status; only GET /v0/status is used", async () => {
    const urls: string[] = [];
    const oc = new OneClick({ fetch: fetchOf((u, i) => { urls.push(`${i.method ?? "GET"} ${u}`); return u.includes("aaaa") ? J({ message: "not found" }, 404) : J({ status: "SUCCESS" }); }) });
    expect(await oc.status("aaaa")).toBeNull();
    expect((await oc.status("bbbb"))?.status).toBe("SUCCESS");
    expect(urls.every((u) => u.startsWith("GET https://1click.chaindefuser.com/v0/status?depositAddress="))).toBe(true);
  });
  it("5xx throws", async () => {
    await expect(new OneClick({ fetch: fetchOf(() => J({}, 503)) }).status("x")).rejects.toThrow(/503/);
  });
  it("malformed JSON is not a usable status", async () => {
    await expect(new OneClick({ fetch: fetchOf(() => J({})) }).status("bbbb")).rejects.toThrow(/couldn't read/);
    await expect(new OneClick({ fetch: fetchOf(() => J({ quoteResponse: { quote: { depositAddress: "bbbb" } } })) }).status("bbbb")).rejects.toThrow(/couldn't read/);
    await expect(new OneClick({ fetch: fetchOf(() => J({ status: 1 })) }).status("bbbb")).rejects.toThrow(/couldn't read/);
    await expect(new OneClick({ fetch: fetchOf(() => J(null)) }).status("bbbb")).rejects.toThrow(/couldn't read/);
  });
});

describe("NearBlocks", () => {
  it("maps v3 account txns into transfers", async () => {
    const nb = new NearBlocks({ fetch: fetchOf((u) => {
      expect(u).toBe("https://api-testnet.nearblocks.io/v3/accounts/a/txns?limit=25");
      return J({ data: [{ transaction_hash: "h", signer_account_id: "a", receiver_account_id: "b", actions_agg: { deposit: "1e21" }, block_timestamp: "1700000000000000000" }] });
    }) });
    expect(await nb.recentTransfers("testnet", "a")).toEqual([{ hash: "h", signer: "a", receiver: "b", depositYocto: 1e21, blockTimestampNs: "1700000000000000000" }]);
  });
  it("429 → throws rate limit", async () => {
    await expect(new NearBlocks({ fetch: fetchOf(() => new Response("", { status: 429 })) }).recentTransfers("testnet", "a")).rejects.toThrow(/rate limit/);
  });
  it("HTTP 5xx and a v3 error envelope throw (never a missing account)", async () => {
    await expect(new NearBlocks({ fetch: fetchOf(() => J({}, 503)) }).accountCreated("testnet", "a")).rejects.toThrow(/HTTP 503/);
    await expect(new NearBlocks({ fetch: fetchOf(() => J({ data: null, errors: [{ message: "API v1 was retired" }] }, 410)) }).accountCreated("testnet", "a")).rejects.toThrow(/HTTP 410/);
  });
  it("accountCreated: indexed account with a date (v3 response shape)", async () => {
    const nb = new NearBlocks({ fetch: fetchOf((u) => {
      expect(u).toBe("https://api-testnet.nearblocks.io/v3/accounts/adelekejr.testnet");
      return J({ data: { account_id: "adelekejr.testnet", created: { transaction_hash: "59b3", block_timestamp: "1651301529639405800" }, deleted: {}, locked: false } });
    }) });
    expect(await nb.accountCreated("testnet", "adelekejr.testnet")).toEqual({ createdMs: 1651301529639, indexed: true, indexedHeight: null });
  });
  it("accountCreated: not indexed → data:null (v3 response shape)", async () => {
    const nb = new NearBlocks({ fetch: fetchOf(() => J({ data: null })) });
    expect(await nb.accountCreated("testnet", "lifeguard-mvtx9n46.testnet")).toEqual({ createdMs: null, indexed: false, indexedHeight: null });
  });
  it("accountCreated: empty created object falls back to stats first_day", async () => {
    const urls: string[] = [];
    const nb = new NearBlocks({ fetch: fetchOf((u) => {
      urls.push(u);
      if (u.endsWith("/stats")) return J({ data: { first_day: "2021-04-03", txns: "12333" } });
      return J({ data: { account_id: "guest-book.testnet", created: {}, deleted: {}, locked: false } });
    }) });
    expect(await nb.accountCreated("testnet", "guest-book.testnet")).toEqual({ createdMs: Date.parse("2021-04-03T00:00:00Z"), indexed: true, indexedHeight: null });
    expect(urls).toEqual([
      "https://api-testnet.nearblocks.io/v3/accounts/guest-book.testnet",
      "https://api-testnet.nearblocks.io/v3/accounts/guest-book.testnet/stats",
    ]);
  });
  it("accountCreated: caches known dates, never caches failures", async () => {
    let n = 0;
    const ok = new NearBlocks({ fetch: fetchOf(() => { n++; return J({ data: { account_id: "a", created: { block_timestamp: "1000000000000000000" } } }); }) });
    await ok.accountCreated("testnet", "a"); await ok.accountCreated("testnet", "a");
    expect(n).toBe(1);
    let m = 0;
    const bad = new NearBlocks({ fetch: fetchOf(() => { m++; return new Response("", { status: 429 }); }) });
    await expect(bad.accountCreated("testnet", "a")).rejects.toThrow(/rate limit/);
    await expect(bad.accountCreated("testnet", "a")).rejects.toThrow(/rate limit/);
    expect(m).toBe(2);
  });
});

describe("liveSources", () => {
  it("network failure surfaces as an error, never a fake 'not found'", async () => {
    const s = liveSources({ fetch: fetchOf(() => { throw new TypeError("fetch failed"); }) });
    await expect(s.viewAccount("testnet", "a.testnet")).rejects.toThrow(/unreachable/);
    await expect(s.oneClickStatus("x")).rejects.toThrow(/unreachable/);
  });
});

describe("NearBlocks send count (first send)", () => {
  it("asks the filtered tx list for from → to and counts the rows (v3 has no public count)", async () => {
    let url = "";
    const nb = new NearBlocks({ fetch: fetchOf((u) => {
      url = u;
      return J({ data: [
        { transaction_hash: "a", signer_account_id: "adelekejr.near", receiver_account_id: "betalife.near" },
        { transaction_hash: "b", signer_account_id: "adelekejr.near", receiver_account_id: "betalife.near" },
        { transaction_hash: "c", signer_account_id: "adelekejr.near", receiver_account_id: "betalife.near" },
        { transaction_hash: "d", signer_account_id: "adelekejr.near", receiver_account_id: "betalife.near" },
      ] });
    }) });
    expect(await nb.sentCount("mainnet", "adelekejr.near", "betalife.near")).toBe(4);
    expect(url).toBe("https://api.nearblocks.io/v3/accounts/adelekejr.near/txns?receiver=betalife.near&limit=100");
  });
  it("zero is zero; rate limit and odd answers throw (never read as 'never sent')", async () => {
    expect(await new NearBlocks({ fetch: fetchOf(() => J({ data: [] })) }).sentCount("testnet", "a.testnet", "b.testnet")).toBe(0);
    await expect(new NearBlocks({ fetch: fetchOf(() => J({}, 429)) }).sentCount("testnet", "a.testnet", "b.testnet")).rejects.toThrow(/rate limit/);
    await expect(new NearBlocks({ fetch: fetchOf(() => J({ data: null })) }).sentCount("testnet", "a.testnet", "b.testnet")).rejects.toThrow();
    await expect(new NearBlocks({ fetch: fetchOf(() => J(null, 404)) }).sentCount("testnet", "a.testnet", "b.testnet")).rejects.toThrow();
  });
  it("live sources expose it", () => expect(typeof liveSources().sentCount).toBe("function"));
});

describe("Account health sources", () => {
  it("view_access_key_list maps full and app keys; unknown account → null", async () => {
    const rpc = new NearRpc({ fetch: fetchOf((_u, i) => {
      const b = JSON.parse(String(i.body));
      expect(b.params).toMatchObject({ request_type: "view_access_key_list", account_id: "a.near" });
      return J({ result: { keys: [
        { public_key: "ed25519:F", access_key: { nonce: 221452907000012, permission: "FullAccess" } },
        { public_key: "ed25519:A", access_key: { nonce: 0, permission: { FunctionCall: { receiver_id: "social.near", method_names: [], allowance: null } } } },
      ] } });
    }) });
    expect(await rpc.viewAccessKeyList("mainnet", "a.near")).toEqual([
      { publicKey: "ed25519:F", nonce: "221452907000012", permission: "FullAccess" },
      { publicKey: "ed25519:A", nonce: "0", permission: { receiverId: "social.near", methodNames: [], allowanceYocto: null } },
    ]);
    const gone = new NearRpc({ fetch: fetchOf(() => J({ error: { cause: { name: "UNKNOWN_ACCOUNT" } } })) });
    expect(await gone.viewAccessKeyList("mainnet", "x.near")).toBeNull();
  });
  it("blockTimeMs reads the header; a skipped height → null", async () => {
    const ok = new NearRpc({ fetch: fetchOf(() => J({ result: { header: { height: 5, timestamp_nanosec: "1700000000123456789" } } })) });
    expect(await ok.blockTimeMs("mainnet", 5)).toBe(1700000000123);
    const skip = new NearRpc({ fetch: fetchOf(() => J({ error: { cause: { name: "UNKNOWN_BLOCK" } } })) });
    expect(await skip.blockTimeMs("mainnet", 6)).toBeNull();
  });
  it("NearBlocks keys: created and deleted dates (v3 response shape)", async () => {
    const nb = new NearBlocks({ fetch: fetchOf((u) => {
      expect(u).toBe("https://api.nearblocks.io/v3/accounts/a.near/keys?limit=50");
      return J({ data: [
        { public_key: "ed25519:F", permission_kind: "FULL_ACCESS", action_timestamp: "1638958193286473000", created: { transaction_hash: "c1", block: { block_timestamp: "1638958193286473000" } }, deleted: {} },
        { public_key: "ed25519:A", permission_kind: "FUNCTION_CALL", created: {}, deleted: { transaction_hash: "d1", block: { block_timestamp: "1652180000000000000" } } },
      ] });
    }) });
    expect(await nb.accountKeys("mainnet", "a.near")).toEqual([
      { publicKey: "ed25519:F", fullAccess: true, createdTx: "c1", createdMs: 1638958193286, deletedTx: null, deletedMs: null },
      { publicKey: "ed25519:A", fullAccess: false, createdTx: null, createdMs: null, deletedTx: "d1", deletedMs: 1652180000000 },
    ]);
  });
  it("nearTx: v3 single object, or data:null when missing", async () => {
    const found = new NearBlocks({ fetch: fetchOf((u) => {
      expect(u).toBe("https://api.nearblocks.io/v3/txns/abc");
      return J({ data: { transaction_hash: "abc", signer_account_id: "a.near", receiver_account_id: "b.near", block_timestamp: "1704092142721467993" } });
    }) });
    expect(await found.nearTx("mainnet", "abc")).toEqual({ hash: "abc", signer: "a.near", receiver: "b.near", blockTimestampNs: "1704092142721467993" });
    expect(await new NearBlocks({ fetch: fetchOf(() => J({ data: null })) }).nearTx("mainnet", "nope")).toBeNull();
  });
});
