import type { Ctx } from "../context.js";
import { networkOfName } from "../classify.js";
import { NETWORKS } from "../networks.js";
import type { Network } from "../types.js";
import { f, skipped, type RuleResult } from "./util.js";

const other = (n: Network): Network => (n === "mainnet" ? "testnet" : "mainnet");

/** "alice.near" ⇄ "alice.testnet"; null for names without a network suffix (or the bare "near"/"testnet"). */
export function twinName(name: string): { twin: string; home: Network } | null {
  const home = networkOfName(name);
  if (!home || name === "near" || name === "testnet") return null;
  const stem = name.slice(0, name.lastIndexOf("."));
  return { twin: `${stem}${home === "mainnet" ? ".testnet" : ".near"}`, home };
}

/**
 * R16 — the same name on the other network. When you're certainly sending on the other network
 * (R1 blocks the mismatch) and the twin exists there, say so (BLOCKED, it names the likely fix).
 * When the wallet only seems to be on the other network, it's a hint (ATTENTION), never a block.
 */
export async function r16OtherNetworkTwin(ctx: Ctx): Promise<RuleResult> {
  const { c, input } = ctx;
  if (c.kind !== "near-named") return skipped("R16", "Not a NEAR name.");
  const t = twinName(c.normalized);
  if (!t) return skipped("R16", "This name has no .near or .testnet ending.");
  const to = c.normalized;
  const certain = t.home !== input.network;
  const wallet = certain ? input.network : input.walletNetwork && input.walletNetwork !== t.home ? input.walletNetwork : null;
  if (!wallet) return skipped("R16", `The ${NETWORKS[input.network].label} name matches the network you're sending on.`);
  const where = NETWORKS[wallet].label;
  const r = await ctx.ask(`rpc-${wallet}`, `account:${t.twin}`, (s) => s.viewAccount(wallet, t.twin), { optional: true });
  if (!r.ok) return f("R16", "PASS", "TWIN_UNKNOWN", `Couldn't look for ${t.twin}`, `Couldn't check whether ${t.twin} exists on ${where} (${r.error}).`);
  if (!r.value) {
    return f("R16", "PASS", "NO_TWIN", `No ${t.twin} on ${where} either`,
      `${to} is a ${t.home} name. The same name on ${where}, ${t.twin}, doesn't exist.`);
  }
  const ev = [{ label: "You typed", value: to }, { label: `On ${wallet}`, value: `${t.twin} exists` }];
  if (certain) {
    return f("R16", "BLOCKED", "OTHER_NETWORK_TWIN", `Wrong network: did you mean ${t.twin}?`,
      `You're sending on ${where}, but ${to} is a ${t.home} name. ${t.twin} exists on ${where}. It's probably who you meant, but the same name on another network can belong to someone else.`,
      { fix: [`If you're sending on ${wallet}, confirm ${t.twin} with the receiver, then use it.`, `If you meant ${t.home}, switch your wallet to ${t.home}.`], evidence: ev });
  }
  return f("R16", "ATTENTION", "MAYBE_OTHER_NETWORK", `Your wallet may be on ${wallet}`,
    `This page looks like a ${wallet} wallet, but ${to} is a ${t.home} name. On ${where} the same name is ${t.twin}, and it exists. If your wallet is on ${wallet}, you probably meant ${t.twin}.`,
    { fix: [`Check which network your wallet is on.`, `On ${wallet}, confirm ${t.twin} with the receiver, then use it. On ${t.home}, ${to} is right.`], evidence: ev });
}
