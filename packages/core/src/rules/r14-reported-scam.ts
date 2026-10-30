import type { Ctx } from "../context.js";
import { reportedScam } from "../reported-scams.js";
import { f, skipped, short, type RuleResult } from "./util.js";

/** R14 — the account is on Gideon's list of publicly reported scam accounts. Local only. */
export function r14ReportedScam(ctx: Ctx): RuleResult {
  const { c, input } = ctx;
  if (!["near-named", "near-implicit", "eth-implicit", "hex64-uppercase"].includes(c.kind)) return skipped("R14", "Not a NEAR account.");
  const s = reportedScam(c.normalized, input.network);
  if (!s) return f("R14", "PASS", "NOT_REPORTED", "Not on Gideon's reported-scam list", "Gideon's short list of publicly reported scam accounts doesn't include it. That list is small: it can't vouch for an address.");
  const name = s.account.length > 40 ? short(s.account, 12, 8) : s.account;
  return f("R14", "BLOCKED", "REPORTED_SCAM", "Reported scam",
    `${name} has been publicly reported as a scam: ${s.what}. Reported on ${s.by}: “${s.quote}”`,
    { fix: ["Don't send. Whoever gave you this address is likely the scammer.", "Read the report, and if you were sent here by someone, stop talking to them."],
      evidence: [{ label: "Report", value: s.url.replace(/^https:\/\/(www\.)?/, ""), url: s.url }, { label: "Account", value: name }] });
}
