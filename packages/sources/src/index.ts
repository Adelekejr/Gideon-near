import type { Sources } from "@gideon/core";
import type { HttpOptions } from "./http.js";
import { NearRpc, type RpcOptions } from "./nearRpc.js";
import { NearBlocks } from "./nearblocks.js";
import { ForeignChains, type ForeignOptions } from "./foreign.js";
import { OneClick } from "./oneclick.js";

export { NearRpc, NearBlocks, ForeignChains, OneClick };
export { nearAiExplainer } from "./nearai.js";
export { SourceError, request, type Fetch, type HttpOptions } from "./http.js";

export interface LiveSourcesOptions extends HttpOptions {
  /** Paid/private RPC adapter: override endpoint URLs and headers. Off by default. */
  rpc?: Omit<RpcOptions, keyof HttpOptions>;
  foreign?: Omit<ForeignOptions, keyof HttpOptions>;
  oneClickBaseUrl?: string;
}

/** Live, free, no-key data sources for the engine. */
export function liveSources(o: LiveSourcesOptions = {}): Sources {
  const http: HttpOptions = { fetch: o.fetch, timeoutMs: o.timeoutMs };
  const rpc = new NearRpc({ ...http, ...o.rpc });
  const nb = new NearBlocks(http);
  const fx = new ForeignChains({ ...http, ...o.foreign });
  const oc = new OneClick({ ...http, baseUrl: o.oneClickBaseUrl });
  return {
    viewAccount: (n, a) => rpc.viewAccount(n, a),
    ftMetadata: (n, c) => rpc.ftMetadata(n, c),
    storageRegistered: (n, c, a) => rpc.storageRegistered(n, c, a),
    tronTx: (h) => fx.tronTx(h),
    ethTx: (h) => fx.ethTx(h),
    btcTx: (h) => fx.btcTx(h),
    oneClickStatus: (d) => oc.status(d),
    recentTransfers: (n, a) => nb.recentTransfers(n, a),
    nearTx: (n, h) => nb.nearTx(n, h),
    communityFlags: (n, reg, a) => rpc.communityFlags(n, reg, a),
    accountCreated: (n, a) => nb.accountCreated(n, a),
  };
}

/** Read optional adapters from environment variables (Node). All off unless set. */
export function sourcesOptionsFromEnv(env: Record<string, string | undefined>): LiveSourcesOptions {
  const urls: Record<string, string[]> = {};
  if (env.GIDEON_RPC_URL_MAINNET) urls.mainnet = [env.GIDEON_RPC_URL_MAINNET];
  if (env.GIDEON_RPC_URL_TESTNET) urls.testnet = [env.GIDEON_RPC_URL_TESTNET];
  const headers = env.GIDEON_RPC_API_KEY ? { Authorization: `Bearer ${env.GIDEON_RPC_API_KEY}` } : undefined;
  return { rpc: { urls, headers } };
}
export { recordingSources, replaySources, recordKey, type Recording, type Recorded } from "./replay.js";
