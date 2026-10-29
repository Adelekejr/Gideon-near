import type { AccountInfo, CommunityFlag, FtMetadata, Network } from "@gideon/core";
import { NETWORKS } from "@gideon/core";
import { json, request, SourceError, type HttpOptions } from "./http.js";

export interface RpcOptions extends HttpOptions {
  /** Replace the free endpoints, e.g. with a paid provider (adapter, off by default). */
  urls?: Partial<Record<Network, string[]>>;
  /** Replace the free archival endpoints (used only to date accounts the indexer hasn't seen). */
  archivalUrls?: Partial<Record<Network, string[]>>;
  /** Extra headers for every RPC call, e.g. { Authorization: "Bearer <key>" }. */
  headers?: Record<string, string>;
}

type RpcReply = { result?: any; error?: { cause?: { name?: string }; name?: string; message?: string; data?: unknown } };

export class NearRpc {
  constructor(private o: RpcOptions = {}) {}

  private urls(network: Network) {
    return this.o.urls?.[network]?.length ? this.o.urls[network]! : NETWORKS[network].rpcUrls;
  }

  /** Try each endpoint in order; only transport failures fall through to the next one. */
  async call(network: Network, method: string, params: unknown, urls = this.urls(network)): Promise<RpcReply> {
    let last = "no RPC endpoint configured";
    for (const url of urls) {
      try {
        const res = await request(url, {
          method: "POST",
          headers: { "content-type": "application/json", ...this.o.headers },
          body: JSON.stringify({ jsonrpc: "2.0", id: "gideon", method, params }),
        }, this.o);
        if (res.status >= 500 || res.status === 429) { last = `${new URL(url).host} HTTP ${res.status}`; continue; }
        return await json<RpcReply>(res, url);
      } catch (e) {
        last = (e as Error).message;
      }
    }
    throw new SourceError(`NEAR RPC (${network}) failed: ${last}`);
  }

  async viewAccount(network: Network, accountId: string): Promise<AccountInfo | null> {
    const r = await this.call(network, "query", { request_type: "view_account", finality: "final", account_id: accountId });
    if (r.error) {
      const name = r.error.cause?.name ?? "";
      if (name === "UNKNOWN_ACCOUNT" || name === "INVALID_ACCOUNT") return null;
      throw new SourceError(`NEAR RPC error: ${name || r.error.message || "unknown"}`);
    }
    return { amountYocto: r.result.amount, codeHash: r.result.code_hash, storageUsage: r.result.storage_usage,
      ...(typeof r.result.block_height === "number" ? { blockHeight: r.result.block_height } : {}) };
  }

  /** Block-rate reference per network (head and an older block), reused for 10 minutes. */
  private ref = new Map<Network, { at: number; h: number; t: number; msPerBlock: number }>();

  private archival(network: Network) {
    return this.o.archivalUrls?.[network]?.length ? this.o.archivalUrls[network]! : NETWORKS[network].archivalRpcUrls;
  }

  private async header(network: Network, blockRef: { finality: "final" } | { block_id: number }): Promise<{ height: number; timestampMs: number }> {
    const r = await this.call(network, "block", blockRef, this.archival(network));
    if (r.error || !r.result?.header) throw new SourceError(`archival block lookup failed: ${r.error?.cause?.name ?? r.error?.message ?? "no header"}`);
    return { height: r.result.header.height, timestampMs: Number(BigInt(r.result.header.timestamp_nanosec ?? r.result.header.timestamp) / 1_000_000n) };
  }

  /** Estimate the block height at a moment, from the current head and the average block time over ~1 day. */
  async heightAt(network: Network, atMs: number): Promise<number> {
    let ref = this.ref.get(network);
    if (!ref || Date.now() - ref.at > 600_000) {
      const head = await this.header(network, { finality: "final" });
      const back = await this.header(network, { block_id: head.height - 100_000 }).catch(() => null);
      const msPerBlock = back && head.height > back.height ? (head.timestampMs - back.timestampMs) / (head.height - back.height) : 1000;
      ref = { at: Date.now(), h: head.height, t: head.timestampMs, msPerBlock };
      this.ref.set(network, ref);
    }
    return Math.max(1, ref.h - Math.round((ref.t - atMs) / ref.msPerBlock));
  }

  /**
   * Did this account exist at a past moment? Reads archival state at the (estimated) block.
   * Used to date accounts newer than the indexer. Skipped heights (no block) try the next few.
   */
  async accountExistedAt(network: Network, accountId: string, atMs: number): Promise<boolean> {
    const h = await this.heightAt(network, atMs);
    for (let i = 0; i < 4; i++) {
      const r = await this.call(network, "query", { request_type: "view_account", block_id: h + i, account_id: accountId }, this.archival(network));
      if (!r.error) return true;
      const name = r.error.cause?.name ?? "";
      if (name === "UNKNOWN_ACCOUNT") return false;
      if (name === "UNKNOWN_BLOCK") continue;
      throw new SourceError(`archival RPC error: ${name || r.error.message || "unknown"}`);
    }
    throw new SourceError("archival RPC: no block near that time");
  }

  async viewFunction<T>(network: Network, contract: string, method: string, args: unknown): Promise<{ ok: true; value: T } | { ok: false; reason: "no-account" | "no-method" }> {
    const r = await this.call(network, "query", {
      request_type: "call_function", finality: "final", account_id: contract, method_name: method,
      args_base64: btoa(JSON.stringify(args)),
    });
    const err = r.error ? JSON.stringify(r.error) : r.result?.error ?? "";
    if (err) {
      if (/UNKNOWN_ACCOUNT|AccountDoesNotExist|does not exist while viewing/.test(err)) return { ok: false, reason: "no-account" };
      if (/MethodNotFound|CodeDoesNotExist|NO_CONTRACT_CODE|CompilationError|contract code/i.test(err)) return { ok: false, reason: "no-method" };
      throw new SourceError(`NEAR RPC view error: ${String(err).slice(0, 120)}`);
    }
    const bytes = new Uint8Array(r.result.result as number[]);
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) as T };
  }

  async ftMetadata(network: Network, contract: string): Promise<FtMetadata | null> {
    const r = await this.viewFunction<FtMetadata>(network, contract, "ft_metadata", {});
    if (!r.ok || !r.value || typeof r.value.symbol !== "string") return null;
    return { name: r.value.name, symbol: r.value.symbol, decimals: r.value.decimals };
  }

  async storageRegistered(network: Network, contract: string, accountId: string): Promise<boolean> {
    const r = await this.viewFunction<unknown>(network, contract, "storage_balance_of", { account_id: accountId });
    if (!r.ok) throw new SourceError(`${contract} has no storage_balance_of`);
    return r.value != null;
  }

  /** R10: `get_flags` on the community flag registry. null = registry account or contract missing. */
  async communityFlags(network: Network, registry: string, accountId: string): Promise<CommunityFlag[] | null> {
    const r = await this.viewFunction<unknown>(network, registry, "get_flags", { account_id: accountId });
    if (!r.ok) return null;
    if (!Array.isArray(r.value)) throw new SourceError(`${registry} get_flags returned an unexpected answer`);
    return r.value.map((x: { reporter?: unknown; reason?: unknown; at_ms?: unknown }) => {
      if (typeof x?.reporter !== "string" || typeof x?.reason !== "string") throw new SourceError(`${registry} get_flags returned an unexpected answer`);
      return { reporter: x.reporter, reason: x.reason, at_ms: Number(x.at_ms ?? 0) };
    });
  }
}
