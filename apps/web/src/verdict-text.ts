import { drainerFailed, drainerWanted, notCheckedCount, notCheckedLines, VERDICT_TEXT, type CheckResult } from "@gideon/core";

/*
 * The website's verdict wording (0.3.1), in one place so the checker, the send page and the home
 * page say the same as the extension, the CLI and the MCP server. Pure: no DOM, tested in test/.
 */

/** The big chip on the checker and the send page. */
export function chipOf(r: CheckResult): string {
  if (r.verdict === "BLOCKED") return "BLOCKED";
  if (r.verdict === "SAFE") return VERDICT_TEXT.safeChip;
  return r.headline?.status === "COULD_NOT_CHECK" ? VERDICT_TEXT.cantCheckChip : "LOOK AGAIN";
}

/** The title when nothing was flagged (there is no headline). */
export function safeTitle(r: CheckResult): string {
  return r.account?.exists ? "Account exists. Nothing wrong found." : "Every check that applies passed on live data.";
}

/** The reason under a SAFE title: the approved body. */
export const safeWhy = (): string => VERDICT_TEXT.safeBody;

/** "Not checked: …" lines for checks that couldn't run (shown, never folded into "not relevant"). */
export function notChecked(r: CheckResult): string[] {
  return notCheckedLines(r);
}

/** "12 ran · 1 not checked · 3 not relevant" for the checks table. */
export function countsLine(r: CheckResult): string {
  const ran = r.findings.filter((f) => f.status !== "SKIPPED").length;
  const nc = notCheckedCount(r);
  const skipped = r.findings.length - ran;
  return `${ran} ran${nc ? ` · ${nc} not checked` : ""} · ${Math.max(0, skipped - nc)} not relevant`;
}

/**
 * The drained-wallet (R18) line: null when there's nothing to say. `noAnswer`: it was wanted but
 * never answered (time-out or error).
 */
export function sendersLine(r: CheckResult, o: { pending?: boolean; noAnswer?: boolean } = {}): string | null {
  if (o.pending) return "Checking recent senders for hacked wallets…";
  const r18 = r.findings.find((f) => f.rule === "R18");
  if (drainerFailed(r) || (!r18 && o.noAnswer && drainerWanted(r))) return `Senders: ${VERDICT_TEXT.drainerFailed}`;
  if (r18 && r18.status !== "SKIPPED" && r.headline?.rule !== "R18") return `Senders: ${r18.title}`;
  return null;
}

/** The home page's short verdict names. */
export const HOME_CHIP: Record<string, string> = { BLOCKED: "Blocked", ATTENTION: "Look again", SAFE: VERDICT_TEXT.safeLabel };
