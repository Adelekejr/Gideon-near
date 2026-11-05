import type { Ctx } from "../context.js";
import { DUST_HUMAN, formatHuman, judgeUnusual, median, parseHumanAmount, rawToHuman } from "../amounts.js";
import { tokenByContract } from "../data.js";
import { historyAsk, senderHistory, senderOf } from "../history.js";
import { VERDICT_TEXT } from "../text.js";
import type { AccountMove, Network } from "../types.js";
import { f, skipped, type RuleResult } from "./util.js";

const NEAR_DECIMALS = 24;

function decimalsOf(network: Network, contract: string | undefined): number {
  if (!contract) return NEAR_DECIMALS;
  return tokenByContract(network, contract.toLowerCase())?.decimals ?? -1;
}

function samplesFromMoves(moves: AccountMove[], from: string, contract: string | undefined, decimals: number): number[] {
  const asset = contract?.toLowerCase() ?? "NEAR";
  const out: number[] = [];
  for (const m of moves) {
    if (m.direction !== "out" || m.asset.toLowerCase() !== asset) continue;
    if (m.counterparty === from) continue;
    try {
      const n = rawToHuman(BigInt(m.amount), decimals);
      if (n >= DUST_HUMAN) out.push(n);
    } catch { /* ignore a non-integer amount */ }
  }
  return out;
}

function samplesFromDeposits(deposits: number[]): number[] {
  return deposits.map((y) => y / 1e24).filter((n) => n >= DUST_HUMAN);
}

/**
 * R19 — this amount against what you usually send.
 * Usual ~100 and this check is 2,000 → LOOK AGAIN: you have not sent this much before.
 * No sender: the rule does not pass (a "not checked" line). A failed history lookup is
 * COULD_NOT_CHECK, never a pass. No earlier sends means there is no usual amount, so the
 * rule stays quiet rather than calling every first amount unusual.
 */
export async function r19UnusualAmount(ctx: Ctx): Promise<RuleResult> {
  const current = parseHumanAmount(ctx.input.amount);
  if (current == null) return skipped("R19", "No amount to compare with what you usually send.");
  const from = senderOf(ctx);
  if (!from) {
    return f("R19", "SKIPPED", "AMOUNT_NO_SENDER", "Not checked: whether this is more than you usually send",
      VERDICT_TEXT.amountNoSender.replace(/^Not checked: whether this is more than you usually send\. /, ""));
  }
  const contract = ctx.input.asset.contract?.toLowerCase();
  const symbol = ctx.input.asset.symbol || (contract ? "token" : "NEAR");
  const decimals = decimalsOf(ctx.input.network, contract);
  if (contract && decimals < 0) {
    return f("R19", "COULD_NOT_CHECK", "AMOUNT_DECIMALS_UNKNOWN", "Couldn't check: whether this is more than you usually send",
      `Gideon doesn't know how many decimals ${symbol} uses, so it can't compare ${formatHuman(current)} ${symbol} with your earlier sends. This amount isn't called normal.`);
  }

  const failed = (why: string) => f("R19", "COULD_NOT_CHECK", "AMOUNT_HISTORY_FAILED",
    "Couldn't check: whether this is more than you usually send",
    `${why} This amount isn't called normal.`,
    { evidence: [{ label: "Amount", value: `${formatHuman(current)} ${symbol}` }, { label: "From", value: from }] });

  if (ctx.can("accountActivity")) {
    const act = await ctx.ask(`activity-${ctx.input.network}`, `activity:${from}`, (s) => s.accountActivity!(ctx.input.network, from), historyAsk(ctx));
    if (!act.ok) return failed(`Couldn't read your recent sends (${act.error}).`);
    return verdict(current, samplesFromMoves(act.value, from, contract, decimals), symbol);
  }

  const hist = await senderHistory(ctx);
  if (!hist) return failed("Gideon couldn't read which account you're sending from.");
  if (!hist.ok) return failed(`Couldn't read your recent sends (${hist.error}).`);
  if (!contract) return verdict(current, samplesFromDeposits(hist.value.transfers.filter((t) => t.signer === from && t.receiver !== from).map((t) => t.depositYocto)), symbol);

  const tagged = hist.value.transfers.flatMap((t) => (t.signer === from ? t.tokens ?? [] : []));
  if (hist.value.transfers.some((t) => t.tokens)) {
    return verdict(current, samplesFromMoves(tagged.map((tk) => ({
      hash: "", atMs: 0, direction: "out" as const, asset: tk.contract, counterparty: tk.receiver, amount: tk.amount,
    })), from, contract, decimals), symbol);
  }
  return skipped("R19", "This build's send history doesn't include token amounts, so the amount wasn't compared.");
}

function verdict(current: number, samples: number[], symbol: string): RuleResult {
  const kept = samples.filter((n) => n >= DUST_HUMAN);
  const j = judgeUnusual(current, kept);
  if (j === "none") return skipped("R19", `No earlier ${symbol} sends to compare ${formatHuman(current)} ${symbol} with.`);
  const usualText = formatHuman(median(kept));
  if (j === "unusual") {
    return f("R19", "ATTENTION", "UNUSUAL_AMOUNT", "You have not sent this much before",
      `Your recent ${symbol} sends are around ${usualText} ${symbol}. This one is ${formatHuman(current)} ${symbol}. Look again before you send.`,
      { evidence: [
        { label: "This amount", value: `${formatHuman(current)} ${symbol}` },
        { label: "Usual", value: `around ${usualText} ${symbol}` },
        { label: "Recent sends", value: String(kept.length) },
      ] });
  }
  return f("R19", "PASS", "USUAL_AMOUNT", "This is in line with what you usually send",
    `Your recent ${symbol} sends are around ${usualText} ${symbol}. This one is ${formatHuman(current)} ${symbol}.`);
}
