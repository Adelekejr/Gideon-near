import type { CheckResult } from "./types.js";

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
  /** The drained-wallet check (R18) failed or timed out. */
  drainerFailed: "couldn't check recent senders for hacked wallets",
} as const;

/** The Arrow G's spoken label, in the verdict's own words (never more than the chip says). */
export const STOP_LABEL = { block: "Stopped", warn: "Look again", safe: "Nothing flagged", idle: "Checking" } as const;

/** Transaction checks Gideon couldn't run but that don't change the verdict (e.g. a balance it can't read). */
export const TX_NOT_CHECKED = "SHARE_NOT_CHECKED";
export function txNotCheckedLines(r: Pick<CheckResult, "findings">): string[] {
  return r.findings.filter((f) => f.status === "SKIPPED" && f.code === TX_NOT_CHECKED).map((f) => `${f.title}. ${f.detail}`);
}

/** Lines for checks that didn't run because Gideon lacked something (shown as "Not checked", never as "not relevant"). */
export function notCheckedLines(r: Pick<CheckResult, "findings">): string[] {
  return r.findings.some((f) => f.code === "SENDER_UNKNOWN") ? [VERDICT_TEXT.senderUnknown] : [];
}

/** How many findings count as "not checked" (vs. "not relevant"). */
export function notCheckedCount(r: Pick<CheckResult, "findings">): number {
  return r.findings.filter((f) => f.code === "SENDER_UNKNOWN" || (f.rule === "R18" && f.code === "FAILED")).length;
}

/** The drained-wallet check (R18) ran but couldn't finish. */
export function drainerFailed(r: Pick<CheckResult, "findings">): boolean {
  return r.findings.some((f) => f.rule === "R18" && f.status === "SKIPPED" && f.code === "FAILED");
}
