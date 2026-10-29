import type { Ctx } from "../context.js";
import { fmtDate } from "../context.js";
import { NETWORKS } from "../networks.js";
import { f, skipped, type RuleResult } from "./util.js";

const DAY = 86_400_000;

/**
 * R11 — how old is the recipient account? Scammers create fresh accounts (often lookalikes) right
 * before they ask for money, so a brand-new account gets a second look even though it really exists.
 * Existence itself always comes from the live chain (R3/R4); this rule only reads the creation date.
 */
export async function r11AccountAge(ctx: Ctx): Promise<RuleResult> {
  const facts = await ctx.accountFacts();
  if (!facts || facts.exists !== true) return skipped("R11", "No live account to date.");
  const where = NETWORKS[facts.network].label;
  const confirm = ["Confirm the account with the recipient another way (call, or a message you started) before sending.", "Send a small test amount first."];

  if (facts.createdAt) {
    const created = Date.parse(facts.createdAt);
    const age = Math.max(0, ctx.now - created);
    const ev = [{ label: "Created", value: facts.createdAt.replace("T", " ").slice(0, 16) + " UTC" }];
    if (age < DAY) {
      return f("R11", "ATTENTION", "NEW_ACCOUNT_TODAY", "Brand-new account, created today",
        `Brand-new account, created today. It really exists on ${where} (checked live). Confirm with the recipient before sending.`,
        { fix: confirm, evidence: ev });
    }
    if (age < 7 * DAY) {
      const n = Math.floor(age / DAY);
      return f("R11", "ATTENTION", "NEW_ACCOUNT", `New account (created ${n} day${n === 1 ? "" : "s"} ago)`,
        `This account was created ${n} day${n === 1 ? "" : "s"} ago (${fmtDate(created)}). It exists on ${where}, but new accounts are what scammers use, so make sure it really belongs to the person you're paying.`,
        { fix: confirm, evidence: ev });
    }
    return f("R11", "PASS", "ACCOUNT_AGE", `Account created ${fmtDate(created)}`,
      `Not a new account: created ${fmtDate(created)}.`, { evidence: ev });
  }

  if (facts.created === "after-indexer" && facts.chainAgeDays != null) {
    // Indexer is behind, but archival chain state dated it: same rules as a known date.
    const d = facts.chainAgeDays;
    const ev = [{ label: "Created", value: d === 0 ? "within the last 24 hours (chain history)" : d < 7 ? `${d} day${d === 1 ? "" : "s"} ago (chain history)` : "more than 7 days ago (chain history)" }];
    if (d === 0) {
      return f("R11", "ATTENTION", "NEW_ACCOUNT_TODAY", "Brand-new account, created today",
        `Brand-new account, created today. It really exists on ${where} (checked live). Confirm with the recipient before sending.`,
        { fix: confirm, evidence: ev });
    }
    if (d < 7) {
      return f("R11", "ATTENTION", "NEW_ACCOUNT", `New account (created ${d} day${d === 1 ? "" : "s"} ago)`,
        `This account was created ${d} day${d === 1 ? "" : "s"} ago (read from chain history; our indexer hasn't caught up yet). It exists on ${where}, but new accounts are what scammers use, so make sure it really belongs to the person you're paying.`,
        { fix: confirm, evidence: ev });
    }
    return f("R11", "PASS", "ACCOUNT_AGE", "Account is more than 7 days old",
      "Not a new account: chain history shows it already existed 7 days ago (our indexer hasn't caught up with it yet).", { evidence: ev });
  }

  if (facts.created === "after-indexer") {
    const lag = facts.indexerLagBlocks;
    return f("R11", "ATTENTION", "NEW_ACCOUNT_UNINDEXED", "Created recently (newer than our indexer's data)",
      `Created recently (newer than our indexer's data). Exists on chain: a live lookup found it on ${where}, but the indexer${facts.indexedHeight ? `, which has data up to block ${facts.indexedHeight.toLocaleString("en-US")}${lag ? ` (${lag.toLocaleString("en-US")} blocks behind the chain)` : ""},` : ""} has no record of it, so it was made after that. Treat it like a brand-new account.`,
      { fix: confirm, evidence: [
        { label: "Created", value: "after the indexer's last block" },
        ...(facts.indexedHeight ? [{ label: "Indexer data up to block", value: String(facts.indexedHeight) }] : []),
      ] });
  }

  return f("R11", "PASS", "CREATED_UNKNOWN", "Creation date unavailable",
    "Gideon couldn't read when this account was created (the free indexer didn't answer or has no date). The account exists; its age isn't part of this verdict.",
    { evidence: [{ label: "Created", value: "date unavailable" }] });
}
