import { exchangesFor, tokensFor } from "./data.js";
import type { Network } from "./types.js";

/** Big, long-running contracts and services. Never "new", never "unseen", never a collector. */
const WELL_KNOWN: Record<Network, string[]> = {
  mainnet: [
    "near", "wrap.near", "usdt.tether-token.near", "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    "v2.ref-finance.near", "intents.near", "meta-pool.near", "lst.rhealab.near", "linear-protocol.near",
    "social.near", "x.paras.near", "marketplace.paras.near", "marketplace.mintbase1.near", "mintbase1.near",
    "contract.main.burrow.near", "aurora", "token.v2.ref-finance.near", "poolv1.near", "lockup.near",
  ],
  testnet: [
    "testnet", "wrap.testnet", "v1.social08.testnet", "intents.testnet", "ref-finance-101.testnet",
    "meta-v2.pool.testnet", "market.mintspace2.testnet", "usdc.fakes.testnet", "usdt.fakes.testnet",
  ],
};

export function wellKnown(network: Network, account: string): boolean {
  const a = account.toLowerCase();
  return WELL_KNOWN[network].includes(a)
    || tokensFor(network).some((t) => t.contract === a)
    || exchangesFor(network).some((e) => e.id === a);
}
