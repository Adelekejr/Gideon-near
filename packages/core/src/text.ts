import type { CheckResult, Finding } from "./types.js";

/*
 * Words shared by every surface (website, extension, CLI, MCP), so a verdict reads the same
 * everywhere. Approved by Hammed for 0.3.1.
 */
export const VERDICT_TEXT = {
  /** Address check, nothing wrong found (was "LOOKS RIGHT" / "SAFE TO SEND"). */
  safeChip: "NO PROBLEMS FOUND",
  safeLabel: "No problems found",
  safeBody: "Gideon checked this address live and found nothing wrong. That isn't a guarantee. Check the address matches the one you were given.",
  /** Transaction / approval check, nothing flagged. */
  txSafeTitle: "Nothing flagged, but check it yourself",
  /** Its chip, the same words as the CLI and MCP. */
  txSafeChip: "NOTHING FLAGGED",
  txSafeBody: "Gideon looked for known dangers in this request and found none. Read every action in your wallet before you approve.",
  /** Approval read only from the wallet's screen (Meteor): who it's from and to, not what it does. */
  screenOnlyTitle: "Gideon could read who this is from and to, but not what it does.",
  screenOnlyBody: "Check every action in your wallet.",
  /** The check didn't finish (sources down, worker gone, time-out). */
  cantCheckChip: "COULDN’T CHECK",
  cantCheckBody: "Gideon couldn't finish checking this request. That isn't a \"safe\". Don't approve until it can.",
  /** The sender is unknown, so the send-history checks didn't run. */
  senderUnknown: "Not checked: your send history. Gideon couldn't tell which account you're sending from, so it didn't check whether this is your first send to this address or whether it looks like someone you've paid before.",
  /** Account-age lookup was asked and didn't produce a date. Not safe. */
  ageUnknown: "Not checked: when this account was created. Gideon couldn't read the creation date, so this send isn't called safe.",
  /** The sender's recent history lookup failed. Not safe. */
  historyUnknown: "Not checked: your recent history. Gideon couldn't read it, so it didn't compare this address with accounts you've dealt with.",
  /** The first-send lookup failed. Not safe. */
  firstSendUnknown: "Not checked: whether you've sent here before. The send-history lookup didn't answer, so this isn't called a send you've made before.",
  /** An amount was given but the sender wasn't, so R19 didn't compare it. Not a pass. */
  amountNoSender: "Not checked: whether this is more than you usually send. Gideon couldn't tell which account you're sending from, so it didn't compare the amount.",
  /** The drained-wallet check (R18) failed or timed out. */
  drainerFailed: "couldn't check recent senders for hacked wallets",
  /**
   * Shown while the drained-wallet check is still running after an otherwise clear result.
   * Not a final pass: the page must not say "no problems found" yet.
   */
  stillCheckingChip: "STILL CHECKING",
  stillCheckingTitle: "Still checking recent senders.",
  stillCheckingBody: "The other checks found nothing wrong, but the look at recent senders has not finished. This is not a final \"no problems found\". Wait for it before you send.",
} as const;

/** The Arrow G's spoken label, in the verdict's own words (never more than the chip says). */
export const STOP_LABEL = { block: "Stopped", warn: "Look again", safe: "Nothing flagged", idle: "Checking" } as const;

/** Transaction checks Gideon couldn't run but that don't change the verdict (e.g. a balance it can't read). */
export const TX_NOT_CHECKED = "SHARE_NOT_CHECKED";
export function txNotCheckedLines(r: Pick<CheckResult, "findings">): string[] {
  return r.findings.filter((f) => f.status === "SKIPPED" && f.code === TX_NOT_CHECKED).map((f) => `${f.title}. ${f.detail}`);
}

/** One "Not checked" sentence for a finding, or null when it isn't one of those lines. */
export function notCheckedLine(f: Finding): string | null {
  if (f.code === "SENDER_UNKNOWN") return VERDICT_TEXT.senderUnknown;
  if (f.code === "CREATED_UNKNOWN" && f.status === "ATTENTION") return VERDICT_TEXT.ageUnknown;
  if (f.code === "HISTORY_UNAVAILABLE" && f.status === "ATTENTION") return VERDICT_TEXT.historyUnknown;
  if (f.code === "FIRST_SEND_UNKNOWN") return VERDICT_TEXT.firstSendUnknown;
  if (f.code === "AMOUNT_NO_SENDER") return VERDICT_TEXT.amountNoSender;
  if (f.code === "SKIPPED_BY_USER") return "Not checked: the drained-wallet check was skipped (--no-drainer). Gideon didn't look at recent senders for hacked wallets.";
  return null;
}

/** Lines for checks that didn't run, or ran but a lookup failed (shown as "Not checked", never as "not relevant"). */
export function notCheckedLines(r: Pick<CheckResult, "findings">): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const f of r.findings) {
    const line = notCheckedLine(f);
    if (line && !seen.has(line)) { seen.add(line); lines.push(line); }
  }
  return lines;
}

/** How many findings count as "not checked" (vs. "not relevant"). Includes failed lookups that make the verdict LOOK AGAIN. */
export function notCheckedCount(r: Pick<CheckResult, "findings">): number {
  return r.findings.filter((f) => notCheckedLine(f) || (f.rule === "R18" && f.code === "FAILED")).length;
}

/** SKIPPED findings that are "not checked", so they aren't also counted as "not relevant". */
export function skippedNotCheckedCount(r: Pick<CheckResult, "findings">): number {
  return r.findings.filter((f) => f.status === "SKIPPED" && (notCheckedLine(f) || (f.rule === "R18" && f.code === "FAILED"))).length;
}

/** The drained-wallet check (R18) ran but couldn't finish. */
export function drainerFailed(r: Pick<CheckResult, "findings">): boolean {
  return r.findings.some((f) => f.rule === "R18" && f.code === "FAILED");
}
