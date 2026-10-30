import type { Ctx } from "../context.js";
import { explorerAccountUrl } from "../networks.js";
import { couldNotCheck, f, skipped, type RuleResult } from "./util.js";

/** R4 — an Ethereum-style 0x address used on NEAR. */
export async function r04EthImplicit(ctx: Ctx): Promise<RuleResult> {
  const { c, input } = ctx;
  if (c.kind !== "eth-implicit") return skipped("R4", "Not a 0x + 40 hex address.");
  const r = await ctx.ask(`rpc-${input.network}`, `account:${c.normalized}`, (s) => s.viewAccount(input.network, c.normalized));
  if (!r.ok) return couldNotCheck("R4", "whether this 0x account exists on NEAR", r.error);
  const ev = [{ label: "Account", value: c.normalized, url: explorerAccountUrl(input.network, c.normalized) }];
  if (r.value) {
    const facts = await ctx.accountFacts();
    return f("R4", "PASS", "ETH_IMPLICIT_EXISTS", "Ethereum-style NEAR account in use",
      `This 0x account already exists on NEAR, so someone uses it with an Ethereum-key wallet. ${facts?.summary ?? ""}`.trim(), { evidence: ev });
  }
  return f("R4", "ATTENTION", "ETH_IMPLICIT_NEW", "This is an Ethereum-style address",
    "On NEAR, a 0x address only works with a wallet that supports Ethereum keys, and this one has never been used on NEAR. Did you mean to send on Ethereum or BSC instead?",
    { fix: ["Ask the receiver which network they expect.", "If they want NEAR, get their NEAR account (name or 64-character account).", "If they want Ethereum or BSC, use a bridge or swap instead."], evidence: [{ label: "Account", value: c.normalized }] });
}
