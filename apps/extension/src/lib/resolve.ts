import { classify, withTimeout, type Network, type Sources } from "@gideon/core";
import { decide, type NetHint, type NetworkMode } from "./network.js";
import type { NetUsed } from "./messages.js";

const LOOKUP = new Set(["near-named", "near-implicit", "eth-implicit", "hex64-uppercase"]);

/**
 * The network one check runs on. Manual mode and pages that prove their network decide outright;
 * otherwise the recipient's suffix decides; with neither, look the account up on both networks
 * (two cheap RPC calls, not two full checks) and check where it lives.
 */
export async function resolveNetwork(
  mode: NetworkMode,
  page: NetHint | undefined,
  to: string,
  sources: Pick<Sources, "viewAccount">,
  timeoutMs?: number,
): Promise<NetUsed> {
  const d = decide(mode, page ?? { network: null, source: "default", sure: false, why: "no network shown on this page" }, to);
  if (d.network !== "both") return { network: d.network, source: d.hint.source, why: d.hint.why, sure: d.mismatchAllowed };
  const c = classify(to);
  if (!LOOKUP.has(c.kind)) return { network: "mainnet", source: "both", why: "couldn't tell from this page; it isn't a NEAR account either way", sure: false };
  const look = (n: Network) => withTimeout(sources.viewAccount(n, c.normalized), timeoutMs, `${n} lookup`).then((a) => (a ? "yes" : "no"), () => "error" as const);
  const [main, test] = await Promise.all([look("mainnet"), look("testnet")]);
  const base = "couldn't tell from this page, so Gideon looked on both networks";
  if (test === "yes" && main !== "yes") return { network: "testnet", source: "both", why: `${base}: it only exists on testnet`, sure: false };
  if (main === "yes" && test === "yes") return { network: "mainnet", source: "both", why: `${base}: it exists on both, showing mainnet. Set Gideon to Testnet if you're on testnet`, sure: false };
  if (main === "yes") return { network: "mainnet", source: "both", why: `${base}: it only exists on mainnet`, sure: false };
  if (main === "error" || test === "error") return { network: "mainnet", source: "both", why: `${base}, but one lookup failed; showing mainnet`, sure: false };
  return { network: "mainnet", source: "both", why: `${base}: not found on either`, sure: false };
}
