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
        ? J({ result: { amount: "10000000000000000000000000", code_hash: "11111111111111111111111111111111", storage_usage: 182 } })
        : J({ error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCOUNT" } } });
    }) });
    expect((await rpc.viewAccount("testnet", "a.testnet"))?.amountYocto).toBe("10000000000000000000000000");
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
});

describe("NearBlocks", () => {
  it("maps txns-only into transfers", async () => {
    const nb = new NearBlocks({ fetch: fetchOf(() => J({ txns: [{ transaction_hash: "h", signer_account_id: "a", receiver_account_id: "b", actions_agg: { deposit: 1e21 } }] })) });
    expect(await nb.recentTransfers("testnet", "a")).toEqual([{ hash: "h", signer: "a", receiver: "b", depositYocto: 1e21, blockTimestampNs: undefined }]);
  });
  it("429 → throws rate limit", async () => {
    await expect(new NearBlocks({ fetch: fetchOf(() => new Response("", { status: 429 })) }).recentTransfers("testnet", "a")).rejects.toThrow(/rate limit/);
  });
});

describe("liveSources", () => {
  it("network failure surfaces as an error, never a fake 'not found'", async () => {
    const s = liveSources({ fetch: fetchOf(() => { throw new TypeError("fetch failed"); }) });
    await expect(s.viewAccount("testnet", "a.testnet")).rejects.toThrow(/unreachable/);
    await expect(s.oneClickStatus("x")).rejects.toThrow(/unreachable/);
  });
});
