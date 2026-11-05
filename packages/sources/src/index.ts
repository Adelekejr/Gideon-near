import { mergeMoves, type Sources } from "@gideon/core";
import type { HttpOptions } from "./http.js";
import { NearRpc, type RpcOptions } from "./nearRpc.js";
import { NearBlocks } from "./nearblocks.js";
import { ForeignChains, type ForeignOptions } from "./foreign.js";
import { OneClick } from "./oneclick.js";
import { FastNearTx, mergedHistory } from "./fastnear.js";

export { NearRpc, NearBlocks, ForeignChains, OneClick, FastNearTx, mergedHistory };
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
  const fast = new FastNearTx(http);
  const oc = new OneClick({ ...http, baseUrl: o.oneClickBaseUrl });
  return {
    viewAccount: (n, a) => rpc.viewAccount(n, a),
    ftMetadata: (n, c) => rpc.ftMetadata(n, c),
    storageRegistered: (n, c, a) => rpc.storageRegistered(n, c, a),
    tronTx: (h) => fx.tronTx(h),
    ethTx: (h) => fx.ethTx(h),
    btcTx: (h) => fx.btcTx(h),
    oneClickStatus: (d) => oc.status(d),
    // Fresh (FastNEAR) and deep (NearBlocks, whose free testnet index can lag weeks) merged.
    recentTransfers: (n, a) => mergedHistory(() => fast.recentTransfers(n, a), () => nb.recentTransfers(n, a)),
    // Fresh (FastNEAR) and deep (NearBlocks). Fails only when both fail, so one outage isn't "no history"
    // and a real outage of both is not called safe.
    accountActivity: async (n, a) => {
      const [x, y] = await Promise.allSettled([fast.accountActivity(n, a), nb.accountActivity(n, a)]);
      if (x.status === "rejected" && y.status === "rejected") throw x.reason;
      return mergeMoves(x.status === "fulfilled" ? x.value : [], y.status === "fulfilled" ? y.value : []);
    },
    nearTx: (n, h) => nb.nearTx(n, h),
    communityFlags: (n, reg, a) => rpc.communityFlags(n, reg, a),
    accountCreated: (n, a) => nb.accountCreated(n, a),
    sentCount: (n, f, t) => nb.sentCount(n, f, t),
    accountExistedAt: (n, a, t) => rpc.accountExistedAt(n, a, t),
    accountAtGenesis: (n, a) => rpc.accountAtGenesis(n, a),
    inboundTxs: (n, a, l) => fast.inboundTxs(n, a, l),
    signedTxsUpTo: (n, a, h, l) => fast.signedTxsUpTo(n, a, h, l),
    txCount: (n, a) => fast.txCount(n, a),
    ftBalance: (n, c, a) => rpc.ftBalance(n, c, a),
    nftToken: (n, c, t) => rpc.nftToken(n, c, t),
    accessKeys: (n, a) => rpc.viewAccessKeyList(n, a),
    keyRecords: (n, a) => nb.accountKeys(n, a),
    txsByHash: (n, h) => fast.txsByHash(n, h),
    signedTxs: (n, a, l) => fast.signedTxs(n, a, l),
    blockTimeMs: (n, h) => rpc.blockTimeMs(n, h),
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
