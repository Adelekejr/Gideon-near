import { drainerFailed, notCheckedLines, VERDICT_TEXT, type CheckResult, type TxCheckResult, type Verdict } from "@gideon/core";

/*
 * What the CLI prints for a verdict (0.3.1): the same words as the website and the extension.
 * The exit code and --json keep the machine value (SAFE / ATTENTION / BLOCKED).
 */

/** The headline word for a send check. */
export function sendLabel(v: Verdict): string {
  return v === "SAFE" ? VERDICT_TEXT.safeChip : v;
}

/** The headline word for a transaction / sign-in check. */
export function txLabel(v: Verdict): string {
  return v === "SAFE" ? "NOTHING FLAGGED" : v;
}

/** Title + body under the verdict when nothing was flagged. */
export function sendSafeText(r: CheckResult): string[] {
  return r.headline ? [] : [r.account?.exists ? "Account exists. Nothing wrong found." : "Every check that applies passed on live data.", VERDICT_TEXT.safeBody];
}
export function txSafeText(r: TxCheckResult): string[] {
  return r.headline ? [] : [VERDICT_TEXT.txSafeTitle, VERDICT_TEXT.txSafeBody];
}

/** "Not checked: …" lines and the failed drained-wallet line; never hidden. */
export function notCheckedText(r: CheckResult): string[] {
  return [...notCheckedLines(r), ...(drainerFailed(r) ? [`Not checked: ${VERDICT_TEXT.drainerFailed}.`] : [])];
}
