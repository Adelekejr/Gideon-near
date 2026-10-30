import type { Network } from "./types.js";

/**
 * Everything that differs between NEAR testnet and mainnet lives here.
 * Switching Gideon to mainnet = pass network "mainnet" (or override these URLs
 * with a paid provider through the sources options). No other code changes.
 */
export interface NetworkConfig {
  id: Network;
  label: string;
  /** Top-level account suffix for named accounts on this network. */
  accountSuffix: ".near" | ".testnet";
  /** JSON-RPC endpoints, tried in order. Free, no key. */
  rpcUrls: string[];
  /** Archival JSON-RPC endpoints (state at a past block), used to date accounts the indexer hasn't seen yet. */
  archivalRpcUrls: string[];
  /** Block explorer for humans. */
  explorer: string;
  /** NearBlocks API base (free tier, about 6 calls per minute). */
  nearblocksApi: string;
  /** FastNEAR transactions API (free, no key, follows the chain head): the sender's newest transactions. */
  txApi: string;
  /** Community flag registry (contracts/flag-registry) read by R10. null until it is deployed. */
  flagRegistry: string | null;
}

export const NETWORKS: Record<Network, NetworkConfig> = {
  testnet: {
    id: "testnet",
    label: "NEAR testnet",
    accountSuffix: ".testnet",
    rpcUrls: ["https://rpc.testnet.fastnear.com", "https://test.rpc.fastnear.com"],
    archivalRpcUrls: ["https://archival-rpc.testnet.fastnear.com"],
    explorer: "https://testnet.nearblocks.io",
    nearblocksApi: "https://api-testnet.nearblocks.io",
    txApi: "https://tx.test.fastnear.com",
    flagRegistry: null,
  },
  mainnet: {
    id: "mainnet",
    label: "NEAR mainnet",
    accountSuffix: ".near",
    rpcUrls: ["https://rpc.mainnet.fastnear.com", "https://free.rpc.fastnear.com"],
    archivalRpcUrls: ["https://archival-rpc.mainnet.fastnear.com"],
    explorer: "https://nearblocks.io",
    nearblocksApi: "https://api.nearblocks.io",
    txApi: "https://tx.main.fastnear.com",
    flagRegistry: null,
  },
};

/** The demo runs on testnet. */
export const DEFAULT_NETWORK: Network = "testnet";

/** NEAR Intents 1Click has no testnet; it is always read on mainnet (hackathon Q-007). */
export const ONECLICK_API = "https://1click.chaindefuser.com";

export function resolveNetwork(value?: string | null): Network {
  if (value == null || value === "") return DEFAULT_NETWORK;
  if (value === "mainnet" || value === "testnet") return value;
  throw new Error(`Unknown network "${value}". Use "testnet" or "mainnet".`);
}

export function explorerAccountUrl(network: Network, account: string): string {
  return `${NETWORKS[network].explorer}/address/${account}`;
}

export function explorerTxUrl(network: Network, hash: string): string {
  return `${NETWORKS[network].explorer}/txns/${hash}`;
}
