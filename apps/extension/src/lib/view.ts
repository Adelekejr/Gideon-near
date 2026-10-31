import { deleteKeyLinks, drainerFailed, drainerWanted, fmtDate, HEALTH_TEXT, notCheckedCount, notCheckedLines, STOP_LABEL, txNotCheckedLines, VERDICT_TEXT, type AccountHealthResult, type CheckResult, type Finding, type KeyReport, type TxCheckResult } from "@gideon/core";

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
  if (r.verdict === "SAFE") return VERDICT_TEXT.safeChip;
  return couldNotCheck(r) ? "COULDN’T CHECK" : "LOOK AGAIN";
}

export function titleOf(r: CheckResult): string {
  if (r.headline) return r.headline.title;
  return r.account?.exists ? "Account exists. Nothing wrong found." : "Every check that applies passed on live data";
}

export function detailOf(r: CheckResult): string {
  if (r.headline) return r.headline.detail;
  return VERDICT_TEXT.safeBody;
}

/** One line of live account facts, shown on every card: exists or not, created, balance. */
export function accountLine(r: CheckResult): string {
  const a = r.account;
  if (!a) return "";
  const v = a.exists === true ? `exists · ${a.createdAt ? `created ${a.createdAt.slice(0, 10)} · ` : ""}${a.balanceNear} NEAR`
    : a.exists === false ? `not found on ${a.network}` : "couldn't check";
  return `<div class="ga"><b>account →</b> ${esc(v)}</div>`;
}

/** Brand mark: the Arrow G. */
export const LOGO =
  '<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="78" y="29" width="13" height="21" fill="#FF4D1A"/><rect x="28" y="33.5" width="25" height="13" fill="currentColor"/><path d="M52 26 L72 40 L52 54 Z" fill="currentColor"/><path d="M68.28 20.74 A34.5 34.5 0 1 0 84.5 50" fill="none" stroke="currentColor" stroke-width="13"/></svg>';

/** The Arrow G in a verdict pose. motion.ts plays it: blocked = bounces off the wall; warn = stops and waits; safe = the wall opens and the arrow passes. */
let gsN = 0;
export function stopper(tone: Tone): string {
  const id = `gsc${(++gsN).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `<svg class="gs ${tone}" viewBox="0 0 100 100" role="img" aria-label="${STOP_LABEL[tone]}">
<defs><clipPath id="${id}"><rect x="70" y="0" width="30" height="50"/></clipPath></defs>
<g clip-path="url(#${id})"><rect class="gs-wall" x="78" y="29" width="13" height="21"/></g>
<g class="gs-arw"><rect x="28" y="33.5" width="25" height="13"/><path d="M52 26 L72 40 L52 54 Z"/></g>
<path class="gs-g" d="M68.28 20.74 A34.5 34.5 0 1 0 84.5 50"/>
<path class="gs-hit" d="M74 26 l-5 -5 M74 54 l-5 5 M84.5 25 v-7"/></svg>`;
}

/** Card head: the Arrow G stage, wordmark, status chip and title. */
function head(tone: Tone, chip: string, title: string): string {
  return `<div class="gh"><div class="gst">${stopper(tone)}</div><div class="ghm"><div class="ghr"><b>GIDEON</b><span class="chip ${tone}">${esc(chip)}</span></div><div class="gt">${esc(title)}</div></div></div>`;
}

function findingLine(f: Finding): string {
  const ev = f.evidence?.[0];
  if (!ev) return "";
  const v = esc(short(ev.value));
  return `<div class="gf"><b>found →</b> ${esc(ev.label)}: ${ev.url && /^https:\/\//.test(ev.url) ? `<a href="${esc(ev.url)}" target="_blank" rel="noopener noreferrer">${v} ↗</a>` : v}</div>`;
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
  /** Which network the check ran on and why, e.g. { network: "testnet", why: "from your wallet's account (x.testnet)" }. */
  net?: { network: string; why: string };
  /** Which sender the check used, e.g. { account: "alice-wallet.near", why: "from your wallet's header" }. */
  sender?: { account: string | null; why: string };
  /** The drained-wallet check (R18) is still looking at recent senders. */
  drainerPending?: boolean;
  /** The drained-wallet check never answered (time-out on the page side). */
  drainerFailed?: boolean;
}

/**
 * "senders → …": the drained-wallet check (R18) while it runs, then its answer when it isn't
 * already the card's headline. "couldn't check" when it failed or ran out of time; nothing when
 * it didn't apply (your own account, a contact, an exchange).
 */
export function drainerLine(r: CheckResult, pending = false, noAnswer = false): string {
  const x = r.findings.find((f) => f.rule === "R18");
  if (!x && noAnswer && drainerWanted(r)) return `<div class="gn"><b>senders →</b> ${esc(VERDICT_TEXT.drainerFailed)}</div>`;
  if (!x) return pending ? `<div class="gn"><b>senders →</b> checking recent senders for hacked wallets…</div>` : "";
  if (drainerFailed(r)) return `<div class="gn"><b>senders →</b> ${esc(VERDICT_TEXT.drainerFailed)}</div>`;
  if (x.status === "SKIPPED" || r.headline?.rule === "R18") return "";
  return `<div class="gn"><b>senders →</b> ${esc(x.title)}</div>`;
}

/** "sender → alice-wallet.near · from your wallet's header", or why it couldn't tell. */
export function senderLine(s: { account: string | null; why: string; confirmed?: boolean }): string {
  if (!s.account && !s.why) return "";
  const line = `<div class="gn"><b>sender →</b> ${s.account ? `${esc(s.account)} · ${esc(s.why)}` : `couldn't tell · ${esc(s.why)}`}</div>`;
  return line + (s.account && !s.confirmed ? confirmMine(s.account) : "");
}

/** UI text added in 0.3.1 (approved). */
export const MINE_TEXT = {
  ask: (a: string) => `Is ${a} yours?`,
  button: "Add to Your accounts",
  added: "Added ✓",
} as const;

/** "Is {account} yours? [Add to Your accounts]": nothing is added to Your accounts without you. */
export function confirmMine(account: string): string {
  return `<div class="gn">${esc(MINE_TEXT.ask(account))} <button type="button" data-act="mine" data-account="${esc(account)}">${esc(MINE_TEXT.button)}</button></div>`;
}

/** Checks that couldn't run because Gideon lacked something: shown, never hidden as "not relevant". */
export function notCheckedHtml(r: CheckResult): string {
  return notCheckedLines(r).map((l) => `<div class="gn">${esc(l)}</div>`).join("");
}

/** "network → testnet · from your wallet's account (…)" */
export function netLine(n: { network: string; why: string }): string {
  return `<div class="gn"><b>network →</b> ${esc(n.network)} · ${esc(n.why)}</div>`;
}

/** One verdict card. Used inline on pages and in the popup. */
export function card(r: CheckResult, o: CardOptions = {}): string {
  const tone = toneOf(r);
  const h = r.headline;
  const fix = h?.fix?.[0];
  return `<div class="gw t-${tone}" role="alert">
${head(tone, statusLabel(r, o.held), titleOf(r))}
<div class="gb">
<div class="gr">${esc(detailOf(r))}</div>
${h ? findingLine(h) : ""}
${accountLine(r)}
${fix ? `<div class="gf"><b>fix →</b> ${esc(fix)}</div>` : ""}
${o.net ? netLine(o.net) : ""}
${o.sender ? senderLine(o.sender) : ""}
${drainerLine(r, o.drainerPending, o.drainerFailed)}
${notCheckedHtml(r)}
<details class="more"><summary>Details · ${r.findings.filter((f) => f.status !== "SKIPPED").length} checks${notCheckedCount(r) ? ` · ${notCheckedCount(r)} not checked` : ""} · ${esc(r.input.network)} · ${r.ms} ms</summary>${findingsList(r)}</details>
${o.actions ? `<div class="gacts">${o.actions}</div>` : ""}
</div></div>`;
}

export function checking(value: string): string {
  return `<div class="gw t-idle" role="status">${head("idle", "Checking", "Checking this address")}
<div class="gb"><div class="gr">Checking <span class="mono">${esc(short(value))}</span> on live NEAR data…</div></div></div>`;
}

export function failed(message: string): string {
  const m = message.trim().replace(/([^.!?])$/, "$1.");
  return `<div class="gw t-warn" role="alert">${head("warn", "COULDN’T CHECK", "Couldn't check this address")}
<div class="gb"><div class="gr">${esc(m)} That doesn't mean the address is safe. Check it another way before you send.</div></div></div>`;
}

/** This page still runs the old copy of Gideon after an update or reload; only reloading the page fixes it. */
export function updated(): string {
  return `<div class="gw t-warn" role="alert">${head("warn", "RELOAD PAGE", "Gideon was updated")}
<div class="gb"><div class="gr">Reload this page to keep checking. Until then this address isn't checked, so check it another way before you send.</div></div></div>`;
}

/** Shown when a page script swaps what you copied for another address, at the moment you copy. */
export function tamperCard(selected: string, written: string): string {
  return `<div class="gw t-block" role="alert">${head("block", "CLIPBOARD CHANGED", "This page changed what you copied")}
<div class="gb">
<div class="gr">You selected one address, but the page put a different one on your clipboard. Don't paste it.</div>
<div class="gf"><b>selected →</b> ${esc(short(selected))}<br><b>clipboard →</b> ${esc(short(written))}</div>
<div class="gacts"><button data-act="dismiss" class="g">Dismiss</button></div></div></div>`;
}

/** The approved footer on every transaction card. */
export const TX_FOOTER = "Gideon only read this request from the page. It never touches your keys.";

/**
 * The card for a transaction request on a wallet's approval screen: same design as the send card
 * (head, reason, found →, fix →, network →, Details), with the footer saying where it was read.
 */
export function txCard(r: TxCheckResult, o: { net?: { network: string; why: string }; actions?: string } = {}): string {
  const tone: Tone = r.verdict === "BLOCKED" ? "block" : r.verdict === "SAFE" ? "safe" : "warn";
  const h = r.headline;
  const chip = r.verdict === "BLOCKED" ? "STOPPED" : r.verdict === "SAFE" ? VERDICT_TEXT.txSafeChip : h?.status === "COULD_NOT_CHECK" ? VERDICT_TEXT.cantCheckChip : "LOOK AGAIN";
  const fix = h?.fix?.[0];
  const shown = r.findings.filter((f) => f.status !== "SKIPPED");
  // Every other warning in the request, under the headline.
  const more = shown.filter((f) => !(h && f.rule === h.rule && f.title === h.title) && (f.status === "BLOCKED" || f.status === "ATTENTION" || f.status === "COULD_NOT_CHECK"));
  return `<div class="gw t-${tone}" role="alert">
${head(tone, chip, h?.title ?? "")}
<div class="gb">
${h?.detail ? `<div class="gr">${esc(h.detail)}</div>` : ""}
${h ? findingLine(h) : ""}
${fix ? `<div class="gf"><b>fix →</b> ${esc(fix)}</div>` : ""}
${more.map((f) => `<div class="gr">${esc(f.title)}${f.detail ? ` ${esc(f.detail)}` : ""}</div>${findingLine(f)}`).join("\n")}
${txNotCheckedLines(r).map((n) => `<div class="gf nc"><b>not checked →</b> ${esc(n)}</div>`).join("\n")}
${o.net ? netLine(o.net) : ""}
<div class="gn">${esc(TX_FOOTER)}</div>
<details class="more"><summary>Details · ${shown.length} checks${o.net ? ` · ${esc(o.net.network)}` : ""} · ${r.ms} ms</summary><ul class="fl">${shown
    .map((f) => `<li class="s-${f.status.toLowerCase()}"><i>${MARK[f.status]}</i><span><b>${esc(f.rule)}</b> ${esc(f.title)}</span></li>`).join("")}</ul></details>
${o.actions ? `<div class="gacts">${o.actions}</div>` : ""}
</div></div>`;
}

const HEALTH_CHIP: Record<AccountHealthResult["status"], [Tone, string]> = {
  danger: ["block", "DANGER"], attention: ["warn", "LOOK AGAIN"], clean: ["safe", "CLEAN"], "not-found": ["warn", "NOT FOUND"], "could-not-check": ["warn", "COULDN’T CHECK"],
};

declare const __GIDEON_SITE__: string | undefined;
/**
 * Gideon's website (its account page connects any NEAR wallet). Set at build time with
 * GIDEON_SITE=https://… ; empty until the site is live, and then only the wallet links show.
 */
export const GIDEON_SITE: string = (typeof __GIDEON_SITE__ === "string" ? __GIDEON_SITE__ : "").replace(/\/+$/, "");
/** The website's account page for one key, or null when no site is set. */
export function siteKeyUrl(r: { account: string; network: string }, publicKey: string, site = GIDEON_SITE): string | null {
  if (!/^https:\/\//.test(site)) return null;
  return `${site}/keys?account=${encodeURIComponent(r.account)}&network=${r.network}&key=${encodeURIComponent(publicKey)}`;
}
export const HEALTH_UI_TEXT = {
  // New in 0.3.0 (beyond the approved text):
  anyWallet: "Remove with any wallet",
} as const;

/** Which key's remove step is open in the account health card, and whether the wallet-key box is ticked. */
export interface HealthUi { open?: string | null; ticked?: boolean; site?: string }

/**
 * The popup's "Check my account" card: same head and lines as the send card. It never signs:
 * "Remove key in my wallet" only shows the confirmation and links that open the wallet's own
 * signing page. The only full control key is never offered for removal, and the probable wallet
 * key's links stay off until its warning is ticked.
 */
export function healthCard(r: AccountHealthResult, ui: HealthUi = {}): string {
  const [tone, chip] = HEALTH_CHIP[r.status];
  const full = r.keys.filter((k) => k.kind === "full").length;
  const wallet = r.keys.find((k) => k.probableWalletKey)?.publicKey;
  const row = (k: KeyReport): string => {
    const what = k.kind === "full" ? "Full control key" : `App key: ${esc(k.contract)}`;
    const when = k.addedAt ? `Added ${esc(fmtDate(Date.parse(k.addedAt)))}` : esc(HEALTH_TEXT.addedUnknown);
    const flags = k.flags.map((f) => `<li class="s-${f.level === "red" ? "blocked" : f.level === "tidy" ? "skipped" : "attention"}"><i>${f.level === "red" ? "✕" : f.level === "tidy" ? "·" : "!"}</i><span>${esc(f.text)}${f.why ? ` ${esc(f.why)}` : ""}</span></li>`).join("");
    let act = "";
    if (k.removable && !(k.kind === "full" && full === 1) && (k.flags.length || ui.open === k.publicKey)) {
      if (ui.open === k.publicKey) {
        const l = deleteKeyLinks(r.network, r.account, k.publicKey, wallet && wallet !== k.publicKey ? { walletKey: wallet } : {});
        const locked = k.probableWalletKey && !ui.ticked;
        const link = (href: string, name: string) => locked ? `<button type="button" class="btn" disabled>Open in ${name} ↗</button>` : `<a class="btn" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Open in ${name} ↗</a>`;
        const site = siteKeyUrl(r, k.publicKey, ui.site ?? GIDEON_SITE);
        const any = site ? (locked ? `<button type="button" class="btn" disabled>${esc(HEALTH_UI_TEXT.anyWallet)} ↗</button>` : `<a class="btn" href="${esc(site)}" target="_blank" rel="noopener noreferrer">${esc(HEALTH_UI_TEXT.anyWallet)} ↗</a>`) : "";
        act = `${k.probableWalletKey ? `<label class="tg"><input type="checkbox" data-tick="1"${ui.ticked ? " checked" : ""}><i></i><span>${esc(HEALTH_TEXT.walletKey)}</span></label>` : ""}
<div class="gf"><b>confirm →</b> ${esc(l.confirm)}</div>
<div class="gacts">${any}${link(l.meteor, "Meteor")}${l.mynearwallet ? link(l.mynearwallet, "MyNearWallet") : ""}<button type="button" class="g" data-close="1">Cancel</button></div>`;
      } else {
        act = `<div class="gacts"><button type="button" data-rm="${esc(k.publicKey)}">${esc(HEALTH_TEXT.removeButton)}</button></div>`;
      }
    } else if (k.kind === "full" && full === 1 && k.flags.length) {
      act = `<div class="gn">This is the only full control key. Removing it would lock you out.</div>`;
    }
    return `<div class="gf"><b>key →</b> ${esc(short(k.publicKey))}<br>${what} · ${when}${k.uses != null ? ` · used ${k.uses}×` : ""}${k.probableWalletKey ? `<br>${esc(HEALTH_TEXT.walletKey)}` : ""}</div>${flags ? `<ul class="fl">${flags}</ul>` : ""}${act}`;
  };
  const flagged = r.keys.filter((k) => k.flags.length && !k.tidy);
  const tidy = r.keys.filter((k) => k.tidy);
  const rest = r.keys.filter((k) => !k.flags.length);
  return `<div class="gw t-${tone}" role="alert">
${head(tone, chip, r.summary)}
<div class="gb">
${r.advice ? `<div class="gr"><b>${esc(r.advice)}</b></div>` : ""}
<div class="ga"><b>account →</b> ${esc(r.account)} · ${esc(r.network)} · ${r.counts.full} full · ${r.counts.app} app</div>
${r.notes.map((n) => `<div class="gn">${esc(n)}</div>`).join("")}
${flagged.map(row).join("")}
${tidy.length ? `<details class="more" open><summary>${esc(HEALTH_TEXT.tidyHeading)} · ${tidy.length}</summary><div class="gn">${esc(HEALTH_TEXT.tidyNote)}</div>${tidy.map(row).join("")}</details>` : ""}
${rest.length ? `<details class="more"${ui.open && rest.some((k) => k.publicKey === ui.open) ? " open" : ""}><summary>Details · ${rest.length} ${rest.length === 1 ? "key" : "keys"} · ${r.ms} ms</summary>${rest.map(row).join("")}</details>` : ""}
<div class="gn">${esc(HEALTH_TEXT.footer)}</div>
</div></div>`;
}
