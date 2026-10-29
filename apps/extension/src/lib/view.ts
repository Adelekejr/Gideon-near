import type { CheckResult, Finding } from "@gideon/core";

export type Tone = "block" | "warn" | "safe" | "idle";

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function couldNotCheck(r: CheckResult): boolean {
  return r.headline?.status === "COULD_NOT_CHECK";
}

/** Vermilion only for BLOCKED, amber for anything that needs a look (including couldn't check), green for safe. */
export function toneOf(r: CheckResult): Tone {
  return r.verdict === "BLOCKED" ? "block" : r.verdict === "SAFE" ? "safe" : "warn";
}

export function statusLabel(r: CheckResult, held = false): string {
  if (r.verdict === "BLOCKED") return held ? "SEND HELD" : "STOPPED";
  if (r.verdict === "SAFE") return "LOOKS RIGHT";
  return couldNotCheck(r) ? "COULDN’T CHECK" : "LOOK AGAIN";
}

export function titleOf(r: CheckResult): string {
  if (r.headline) return r.headline.title;
  return "Every check that applies passed on live data";
}

export function detailOf(r: CheckResult): string {
  if (r.headline) return r.headline.detail;
  return "Gideon read the account from public chain data and found nothing wrong.";
}

export const LOGO =
  '<svg viewBox="0 0 88 88" aria-hidden="true"><rect x="4" y="38" width="44" height="12" fill="currentColor"/><path d="M44 24 L66 44 L44 64 Z" fill="currentColor"/><rect x="71" y="10" width="11" height="68" fill="#FF4D1A"/></svg>';

/** The animated mark: the arrow bounces off the wall when blocked; the wall lifts when safe. */
export function stopper(tone: Tone): string {
  const state = tone === "block" ? "block" : tone === "safe" ? "safe" : "idle";
  return `<svg class="gs ${state} t-${tone}" viewBox="0 0 200 88" role="img" aria-label="${state === "block" ? "Send stopped" : state === "safe" ? "Send cleared" : "Gideon"}">
<g class="gs-arw"><rect x="6" y="38" width="112" height="12"/><path d="M114 24 L136 44 L114 64 Z"/></g>
<g class="gs-hit"><path d="M140 18 l-7 -9 M140 70 l-7 9 M128 14 l-2 -10 M128 74 l-2 10"/></g>
<rect class="gs-wall" x="146" y="10" width="11" height="68"/></svg>`;
}

function findingLine(f: Finding): string {
  const ev = f.evidence?.[0];
  return ev ? `<div class="gf"><b>found →</b> ${esc(ev.label)}: ${esc(short(ev.value))}</div>` : "";
}

export function short(v: string): string {
  return v.length > 30 ? `${v.slice(0, 12)}…${v.slice(-8)}` : v;
}

const MARK: Record<string, string> = { BLOCKED: "✕", ATTENTION: "!", PASS: "✓", COULD_NOT_CHECK: "?", SKIPPED: "·" };

/** All rules that ran, for the "Details" fold. */
export function findingsList(r: CheckResult): string {
  return `<ul class="fl">${r.findings
    .filter((f) => f.status !== "SKIPPED")
    .map((f) => `<li class="s-${f.status.toLowerCase()}"><i>${MARK[f.status]}</i><span><b>${esc(f.rule)}</b> ${esc(f.title)}</span></li>`)
    .join("")}</ul>`;
}

export interface CardOptions {
  held?: boolean;
  /** Buttons, already escaped HTML. */
  actions?: string;
  network?: boolean;
}

/** One verdict card. Used inline on pages and in the popup. */
export function card(r: CheckResult, o: CardOptions = {}): string {
  const tone = toneOf(r);
  const h = r.headline;
  const fix = h?.fix?.[0];
  return `<div class="gw t-${tone}" role="alert">
<div class="gh">${stopper(tone)}<b>GIDEON</b><span>■ ${esc(statusLabel(r, o.held))}</span></div>
<div class="gb">
<div class="gt">${esc(titleOf(r))}</div>
<div class="gr">${esc(detailOf(r))}</div>
${h ? findingLine(h) : ""}
${fix ? `<div class="gf"><b>fix →</b> ${esc(fix)}</div>` : ""}
<details class="more"><summary>Details · ${r.findings.filter((f) => f.status !== "SKIPPED").length} checks · ${esc(r.input.network)} · ${r.ms} ms</summary>${findingsList(r)}</details>
${o.actions ? `<div class="ga">${o.actions}</div>` : ""}
</div></div>`;
}

export function checking(value: string): string {
  return `<div class="gw t-idle" role="status"><div class="gh">${stopper("idle")}<b>GIDEON</b><span>■ CHECKING</span></div>
<div class="gb"><div class="gr">Checking <span class="mono">${esc(short(value))}</span> on live chain data…</div></div></div>`;
}

export function failed(message: string): string {
  return `<div class="gw t-warn" role="alert"><div class="gh">${stopper("warn")}<b>GIDEON</b><span>■ COULDN’T CHECK</span></div>
<div class="gb"><div class="gt">Couldn't check this address</div><div class="gr">${esc(message)} This is not a safe. Check the address another way before you send.</div></div></div>`;
}

/** Shown when a page script swaps what you copied for another address, at the moment you copy. */
export function tamperCard(selected: string, written: string): string {
  return `<div class="gw t-block" role="alert"><div class="gh">${stopper("block")}<b>GIDEON</b><span>■ CLIPBOARD CHANGED</span></div>
<div class="gb"><div class="gt">This page changed what you copied</div>
<div class="gr">You selected one address, but the page put a different one on your clipboard. Don't paste it.</div>
<div class="gf"><b>selected →</b> ${esc(short(selected))}<br><b>clipboard →</b> ${esc(short(written))}</div>
<div class="ga"><button data-act="dismiss" class="g">Dismiss</button></div></div></div>`;
}
