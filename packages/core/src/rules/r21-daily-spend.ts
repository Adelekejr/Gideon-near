import type { Ctx } from "../context.js";
import { formatHuman, parseHumanAmount } from "../amounts.js";
import type { Evidence, Finding } from "../types.js";
import { f, skipped, type RuleResult } from "./util.js";

/** A NEAR amount, including 0. Null when it isn't a number. */
export function humanNear(amount: string | undefined): number | null {
  if (amount == null) return null;
  const s = amount.trim();
  if (!s) return null;
  if (/^0(?:\.0+)?$/.test(s)) return 0;
  return parseHumanAmount(s);
}

function money(n: number): string {
  return `${formatHuman(n)} NEAR`;
}

/**
 * Compare one send with a daily NEAR cap. No cap → not applicable.
 * Over the cap, a cap that isn't a number, a missing amount, or a missing sender → LOOK AGAIN.
 */
export function judgeDailySpend(o: { limit: string; spent?: string; amount?: string; from?: string }): Finding {
  const limit = humanNear(o.limit);
  if (limit == null) {
    return f("R21", "ATTENTION", "DAILY_SPEND_UNKNOWN", "The daily spend limit isn't a number",
      `Gideon was given “${o.limit.trim().slice(0, 40)}” as the daily limit and won't treat a send as inside a limit it can't read.`,
      { fix: ["Set the daily limit as a NEAR amount, such as 25.", "Ask a human before sending."] });
  }
  if (!o.from?.trim()) {
    return f("R21", "ATTENTION", "DAILY_SPEND_NO_SENDER", "The daily limit needs the sending account",
      "A daily spend limit is set, but this check doesn't say which account is sending, so Gideon can't count it. Ask a human.",
      { fix: ["Pass the sending account and check again.", "Ask a human before sending."] });
  }
  const amount = humanNear(o.amount);
  if (amount == null) {
    return f("R21", "ATTENTION", "DAILY_SPEND_UNKNOWN", "No amount to compare with the daily limit",
      "A daily spend limit is set, but this check has no amount. Gideon won't call that inside the limit.",
      { fix: ["Include the amount and check again.", "Ask a human before sending."] });
  }
  const spent = o.spent?.trim() ? humanNear(o.spent) : 0;
  if (spent == null) {
    return f("R21", "ATTENTION", "DAILY_SPEND_UNKNOWN", "Today's spend isn't a number",
      "Gideon couldn't read how much was already counted today, so it won't call this send inside the limit.",
      { fix: ["Ask a human before sending."] });
  }
  const next = spent + amount;
  const evidence: Evidence[] = [
    { label: "Limit", value: money(limit) },
    { label: "Already today", value: money(spent) },
    { label: "This send", value: money(amount) },
  ];
  if (next > limit + 1e-9) {
    return f("R21", "ATTENTION", "DAILY_SPEND_CAP", "This would pass today's spend limit",
      `The daily limit is ${money(limit)}. ${money(spent)} is already counted today, and this send is ${money(amount)} (${money(next)} in all). Ask a human before sending.`,
      { fix: ["Ask a human before this send.", "A human can allow it. Gideon will not send it on its own."], evidence });
  }
  return f("R21", "PASS", "DAILY_SPEND_OK", "Inside today's spend limit",
    `The daily limit is ${money(limit)}. This send of ${money(amount)} would make ${money(next)} today.`,
    { evidence });
}

/** A token move the NEAR cap can't price. LOOK AGAIN, never treated as inside the limit. */
export function unpricedSpend(): Finding {
  return f("R21", "ATTENTION", "DAILY_SPEND_UNPRICED", "This moves a token the daily limit can't price",
    "The daily limit is in NEAR. This request moves a token, or Gideon couldn't read the amount, so it can't tell whether the send stays inside the limit. Ask a human.",
    { fix: ["Ask a human before approving.", "Check the token amount in your wallet."] });
}

/** R21 — agent daily spend cap. Quiet when no limit was set. */
export function r21DailySpend(ctx: Ctx): RuleResult {
  const limit = ctx.input.dailyLimit?.trim();
  if (!limit) return skipped("R21", "No daily spend limit is set for this check.");
  return judgeDailySpend({
    limit,
    ...(ctx.input.spentToday != null ? { spent: ctx.input.spentToday } : {}),
    ...(ctx.input.amount != null ? { amount: ctx.input.amount } : {}),
    ...(ctx.input.from != null ? { from: ctx.input.from } : {}),
  });
}
