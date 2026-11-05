import type { Ctx } from "../context.js";
import { judgeDeposit } from "../deposits.js";
import { couldNotCheck, f, skipped, type RuleResult } from "./util.js";

/**
 * R6 — NEAR Intents 1Click deposit address. Read-only: only GET /v0/status.
 * 1Click runs on mainnet only. Wrong chain, wrong token, or an expired quote is BLOCKED.
 * A lookup that fails is LOOK AGAIN, never a pass.
 */
export async function r06Intents(ctx: Ctx): Promise<RuleResult> {
  const { c, input } = ctx;
  const wantsIntents = input.destination === "intents";
  if (c.kind !== "near-implicit" && c.kind !== "hex64-uppercase") {
    if (wantsIntents) {
      return f("R6", "ATTENTION", "NOT_A_DEPOSIT_FORMAT", "Not a 1Click deposit address",
        "NEAR Intents 1Click deposit addresses on NEAR are 64-character accounts. This isn't one.",
        { fix: ["Copy the deposit address again from the swap app."] });
    }
    return skipped("R6", "Not a 64-character account, so not a 1Click deposit address.");
  }

  const addr = c.normalized;
  const r = await ctx.ask("1click", addr, (s) => s.oneClickStatus(addr));
  if (!r.ok) return couldNotCheck("R6", "whether this is a NEAR Intents deposit address", r.error);
  if (!r.value) {
    if (wantsIntents || input.bridgeChain?.trim()) {
      const named = input.bridgeChain?.trim();
      if (named && !wantsIntents) {
        return f("R6", "ATTENTION", "CHAIN_UNCONFIRMED", "Payout chain isn't confirmed",
          `This was described as paying out on ${named}, but 1Click has no swap for this address. Gideon won't call that a match.`,
          { fix: ["Copy the deposit address again from the swap app, or start a new quote."] });
      }
      return f("R6", "ATTENTION", "UNKNOWN_DEPOSIT_ADDRESS", "1Click doesn't know this deposit address",
        named
          ? `You said this pays out on ${named}, but 1Click has no swap for this address.`
          : "You said this is a NEAR Intents deposit, but 1Click has no swap for this address.",
        { fix: ["Copy the deposit address again from the swap app, or start a new quote."] });
    }
    return f("R6", "SKIPPED", "NOT_A_DEPOSIT_ADDRESS", "Not a NEAR Intents deposit address", "1Click has no swap for this address.");
  }

  return judgeDeposit("R6", {
    address: addr,
    network: input.network,
    sentAsset: input.asset.contract ? `nep141:${input.asset.contract}` : "native",
    symbol: input.asset.symbol,
    ...(input.amount ? { amount: input.amount } : {}),
    ...(input.bridgeChain ? { bridgeChain: input.bridgeChain } : {}),
    now: ctx.now,
    status: r.value,
  });
}
