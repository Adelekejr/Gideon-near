import type { Network } from "@gideon/core";
import { addContact, load, saveContacts, withDefaults, type Settings } from "./lib/settings.js";
import { addressLike, ClipboardWatch, copyTampered } from "./lib/clipboard.js";
import { findSendButtons, plainTrim, isRecipientField, isTextField, shouldCheck, type Field } from "./lib/detect.js";
import { card, checking, failed, MINE_TEXT, tamperCard, toneOf, txCard, updated } from "./lib/view.js";
import { STYLE, STYLE_WARN_FIX } from "./lib/style.js";
import { extensionAlive, sendCheck, sendDrainer, sendTx, type CheckResponse } from "./lib/messages.js";
import { findApproval, greenAllowed } from "./lib/approval.js";
import { collectSignals, pageHint, recipientScope } from "./lib/network.js";
import { pageAccounts } from "./lib/wallets.js";
import { rememberAccount, rememberSend, senderHint, type SenderHint } from "./lib/sender.js";
import { placement } from "./lib/place.js";
import { asMode, loadTheme, themeOf, type Mode } from "./lib/shift.js";
import { playAll } from "./lib/motion.js";
import { drainerWanted, unfinishedRequest, unreadableRequest, type CheckResult, type Contact } from "@gideon/core";
import { LIMITS } from "./lib/limits.js";
import { missingOptional } from "./lib/runcache.js";

/*
 * Gideon content script. It only reacts to text you paste or type into a field that
 * looks like a send recipient (or to a value that can only be an address or hash),
 * sends that one value to the extension's service worker for checking, and shows the
 * result next to the field.
 *
 * In Auto network mode it also looks, on this device, at the page address and at short
 * texts that are a NEAR account name or a "Testnet" / "Mainnet" badge (lib/network.ts),
 * to tell which network the wallet is on. Only the answer (testnet / mainnet / not sure,
 * and the account it came from) goes to the worker; no other page text leaves the page.
 *
 * On a wallet's approval screen it also reads the transaction request (lib/approval.ts: from the
 * page address, or Meteor's approval screen) and shows Gideon's card before you press Approve.
 * Only the request goes to the worker. Never keys, never the clipboard.
 *
 * Only real input counts: events a page script makes up (`isTrusted` false) are ignored, so a page
 * can't fake a paste, a copy, a press of Send (which would plant a "past send") or a press of
 * Gideon's own buttons.
 */

let settings: Settings = withDefaults({}).settings;
let contacts: Contact[] = [];
const watch = new ClipboardWatch();
let mode: Mode = "system";
void loadTheme().then((v) => {
  mode = v;
  if (panel) content(panel).dataset.theme = themeOf(mode);
});

void load().then((s) => {
  settings = s.settings;
  contacts = s.contacts;
});
chrome.storage.onChanged.addListener((ch) => {
  if (ch.settings) settings = withDefaults({ settings: ch.settings.newValue }).settings;
  if (ch.theme) {
    mode = asMode(ch.theme.newValue);
    if (panel) content(panel).dataset.theme = themeOf(mode);
  }
  if (ch.contacts) contacts = withDefaults({ contacts: ch.contacts.newValue }).contacts;
});

/* ---------- the warning panel, in a shadow root so the page can't restyle it ---------- */

const COLORS = {
  light: { block: "#D42A10", warn: "#E8A400", safe: "#4FB57A", idle: "#5E5A50" },
  dark: { block: "#FF5A36", warn: "#F2B01E", safe: "#4FB57A", idle: "#8F8A7E" },
} as const;

interface Panel {
  host: HTMLElement;
  root: ShadowRoot;
  field: Field | null;
  /** The value being checked or shown for `field`. */
  value: string;
  seq: number;
  held: HTMLElement[];
  prevOutline: string;
  /** The answer showing for `value`, to remember the send if you press Send. */
  shown?: { to: string; network: Network; verdict: string; from?: string };
}

let panel: Panel | null = null;
let fontsAdded = false;

function addFonts(): void {
  if (fontsAdded) return;
  fontsAdded = true;
  try {
    const s = document.createElement("style");
    s.id = "gideon-fonts";
    const u = (f: string) => chrome.runtime.getURL(f);
    s.textContent = `@font-face{font-family:'Bricolage Grotesque';src:url(${u("fonts/Bricolage.woff2")}) format('woff2');font-weight:200 800;font-stretch:75% 100%;font-display:swap}
@font-face{font-family:'Newsreader';src:url(${u("fonts/Newsreader.woff2")}) format('woff2');font-weight:200 800;font-display:swap}
@font-face{font-family:'Newsreader';src:url(${u("fonts/Newsreader-Italic.woff2")}) format('woff2');font-weight:200 800;font-style:italic;font-display:swap}
@font-face{font-family:'JetBrains Mono';src:url(${u("fonts/JetBrainsMono.woff2")}) format('woff2');font-weight:100 800;font-display:swap}`;
    (document.head ?? document.documentElement).appendChild(s);
  } catch {
    /* system fonts are fine */
  }
}

function getPanel(): Panel {
  if (panel && panel.host.isConnected) return panel;
  addFonts();
  const host = document.createElement("gideon-watch");
  host.style.cssText = "position:absolute;z-index:2147483646;top:0;left:0;width:380px;display:none";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = STYLE + STYLE_WARN_FIX + ".g-root{display:block}";
  const div = document.createElement("div");
  div.className = "g-root";
  root.append(style, div);
  root.addEventListener("click", onPanelClick);
  document.documentElement.appendChild(host);
  panel = { host, root, field: null, value: "", seq: 0, held: [], prevOutline: "" };
  return panel;
}

function content(p: Panel): HTMLElement {
  return p.root.querySelector(".g-root") as HTMLElement;
}

function place(): void {
  const p = panel;
  if (!p || p.host.style.display === "none") return;
  if (p.field && !p.field.isConnected) return hide();
  const vv = window.visualViewport;
  const view = vv
    ? { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height }
    : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  const field = p.field ? p.field.getBoundingClientRect() : null;
  const at = placement(field, view, p.host.scrollHeight || 220);
  p.host.style.width = `${at.width}px`;
  p.host.style.maxHeight = `${at.maxHeight}px`;
  p.host.style.overflowY = "auto";
  p.host.style.overscrollBehavior = "contain";
  p.host.style.left = `${at.left + window.scrollX}px`;
  p.host.style.top = `${at.top + window.scrollY}px`;
}

let raf = 0;
function schedulePlace(): void {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    place();
  });
}
window.addEventListener("scroll", schedulePlace, { passive: true, capture: true });
window.addEventListener("resize", schedulePlace, { passive: true });
// Phones: the on-screen keyboard shrinks the visual viewport without a window resize.
window.visualViewport?.addEventListener("resize", schedulePlace, { passive: true });
window.visualViewport?.addEventListener("scroll", schedulePlace, { passive: true });

function show(field: Field | null, html: string, tone: keyof (typeof COLORS)["light"], animate = true): void {
  const p = getPanel();
  if (p.field && p.field !== field) restoreOutline(p);
  if (field && p.field !== field) p.prevOutline = field.style.outline;
  p.field = field;
  const box = content(p);
  box.dataset.theme = themeOf(mode);
  box.innerHTML = html;
  p.host.style.display = "block";
  if (field) {
    field.style.outline = `2px solid ${COLORS[themeOf(mode)][tone]}`;
    field.style.outlineOffset = "1px";
  }
  place();
  schedulePlace(); // again once the card has its real height
  if (animate) playAll(box);
}

function restoreOutline(p: Panel): void {
  if (p.field) {
    p.field.style.outline = p.prevOutline;
    p.field.style.outlineOffset = "";
  }
}

function hide(): void {
  const p = panel;
  if (!p) return;
  release(p);
  restoreOutline(p);
  p.field = null;
  p.value = "";
  p.seq++;
  p.host.style.display = "none";
}

/* ---------- holding the Send button ---------- */

function hold(p: Panel, field: Field): void {
  release(p);
  p.held = findSendButtons(field);
  for (const b of p.held) {
    b.dataset.gideonHeld = (b as HTMLButtonElement).disabled ? "was-disabled" : "1";
    if ("disabled" in b) (b as HTMLButtonElement).disabled = true;
    b.setAttribute("aria-disabled", "true");
    b.title = "Held by Gideon: this send looks like a mistake";
  }
}

function release(p: Panel): void {
  for (const b of p.held) {
    if (b.dataset.gideonHeld !== "was-disabled" && "disabled" in b) (b as HTMLButtonElement).disabled = false;
    b.removeAttribute("aria-disabled");
    if (b.title.startsWith("Held by Gideon")) b.removeAttribute("title");
    delete b.dataset.gideonHeld;
  }
  p.held = [];
}

function isHeld(t: EventTarget | null): boolean {
  return !!panel?.held.some((b) => t instanceof Node && b.contains(t));
}
document.addEventListener("click", (e) => {
  if (isHeld(e.target)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
  if (e.isTrusted) noteSend(e.target);
}, true);

/**
 * You pressed the page's Send button for a recipient Gideon checked (and didn't stop): remember it
 * on this device, so a lookalike of it is caught next time even before the explorers catch up.
 * Recipients Gideon stopped are never remembered, even if you sent anyway.
 */
// The last verdict shown, kept after the card is dismissed (you usually dismiss it, then press Send).
let lastShown: { field: Field; value: string; to: string; network: Network; verdict: string; from?: string } | null = null;
function pageStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function noteSend(t: EventTarget | null): void {
  const c = lastShown;
  if (!c || c.verdict === "BLOCKED" || !(t instanceof Node) || !c.field.isConnected) return;
  if (plainTrim(c.field.value) !== plainTrim(c.value)) return;
  if (!findSendButtons(c.field).some((b) => b.contains(t))) return;
  if (!extensionAlive()) return;
  const s = { network: c.network, to: c.to, at: Date.now(), ...(c.from ? { from: c.from } : {}) };
  void chrome.storage.local.get("sends").then((raw) => {
    const list = Array.isArray(raw.sends) ? raw.sends : [];
    return chrome.storage.local.set({ sends: rememberSend(list, s) });
  }).catch(() => undefined);
}
document.addEventListener("submit", (e) => {
  const f = panel?.field?.form;
  if (f && panel!.held.length && e.target === f) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, true);

/* ---------- panel buttons ---------- */

function setFieldValue(field: Field, value: string): void {
  const proto = field.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

function onPanelClick(e: Event): void {
  if (!e.isTrusted) return;
  const btn = (e.target as Element).closest?.("button[data-act]") as HTMLButtonElement | null;
  if (!btn || !panel) return;
  const p = panel;
  const act = btn.dataset.act;
  if (act === "clear" && p.field) {
    const f = p.field;
    hide();
    setFieldValue(f, "");
    f.focus();
  } else if (act === "release") {
    release(p);
    btn.remove();
  } else if (act === "save" && p.field) {
    const account = btn.dataset.account ?? "";
    contacts = addContact(contacts, account);
    void saveContacts(contacts);
    btn.textContent = "Saved ✓";
    btn.disabled = true;
  } else if (act === "mine") {
    // You said this account is yours: only now does it count as yours.
    const account = btn.dataset.account ?? "";
    if (!extensionAlive()) return;
    void chrome.storage.local.get("myAccounts").then((raw) => {
      const list = Array.isArray(raw.myAccounts) ? (raw.myAccounts as unknown[]).filter((a): a is string => typeof a === "string") : [];
      return chrome.storage.local.set({ myAccounts: rememberAccount(list, account) });
    }).catch(() => undefined);
    btn.textContent = MINE_TEXT.added;
    btn.disabled = true;
  } else if (act === "retry-approval") {
    approvalKey = "";
    approvalTries = 0;
    void scanApproval();
  } else if (act === "dismiss") {
    hide();
  }
}

function actionsFor(r: CheckResult, held: boolean): string {
  if (r.verdict === "SAFE") {
    const saved = contacts.some((c) => c.account === r.classification.normalized);
    return `${saved ? "" : `<button data-act="save" data-account="${escAttr(r.classification.normalized)}">Save to address book</button>`}<button data-act="dismiss" class="g">Dismiss</button>`;
  }
  return `<button data-act="clear">Clear field</button>${held ? '<button data-act="release" class="g">Send anyway</button>' : ""}<button data-act="dismiss" class="g">Dismiss</button>`;
}

function escAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/* ---------- running a check ---------- */

/** True when this exact value is already being checked, or its card is showing, for this field. */
function alreadyChecking(field: Field, value: string): boolean {
  const p = panel;
  return !!p && p.field === field && p.value === value && p.host.style.display !== "none";
}

/**
 * Set once Gideon was updated, reloaded or removed while this page stayed open: this script is the
 * old copy and Chrome has cut it off. It stops asking the extension (every call would fail with
 * "Extension context invalidated") and only shows the reload card when you enter an address.
 */
let orphaned = false;

function showUpdated(field: Field): void {
  orphaned = true;
  const p = getPanel();
  p.seq++;
  release(p);
  show(field, updated(), "warn");
}

async function run(field: Field, value: string, copied: string | null, force = false): Promise<void> {
  if (orphaned || !extensionAlive()) {
    if (!(panel?.field === field && panel.host.style.display !== "none" && orphaned)) showUpdated(field);
    return;
  }
  // Wallets re-render and fire input events without the address changing; don't restart the check.
  if (!force && alreadyChecking(field, value)) return;
  const p = getPanel();
  const seq = ++p.seq;
  release(p);
  show(field, checking(value), "idle");
  p.seq = seq;
  p.value = value;
  let page;
  let sender: SenderHint = {};
  try {
    const signals = collectSignals(document, recipientScope(field));
    page = settings.networkMode === "auto" ? pageHint(location.href, signals) : undefined;
    // The wallet's signed-in account is the sender: its history feeds the lookalike and first-send checks.
    sender = senderHint(signals, pageAccounts(document, location.href, pageStorage()));
  } catch {
    page = undefined;
  }
  const req = {
    input: { to: value, ...(copied ? { clipboard: { copied } } : {}) },
    host: location.host,
    ...(page ? { page } : {}),
    ...(sender.account || sender.shown || sender.ambiguous ? { sender } : {}),
  };
  const res = await sendCheck(req, LIMITS.pageWaitMs);
  if (p.seq !== seq || p.field !== field) return; // a newer check replaced this one
  if (!res.ok) {
    if (res.orphaned) return showUpdated(field);
    show(field, failed(res.error), "warn");
    return;
  }
  // The verdict shows first. The drained-wallet check (R18) then looks at the recipient's recent
  // senders in the background and updates this card when it answers (or says it couldn't check).
  const drainer = drainerWanted(res.result);
  render(p, field, res, true, drainer);
  const current = (): boolean => p.seq === seq && p.field === field;
  const withDrainer = async (r: Extract<CheckResponse, { ok: true }>): Promise<void> => {
    if (!drainerWanted(r.result)) return;
    const merged = await sendDrainer(r.result, LIMITS.drainerWaitMs);
    if (!current()) return;
    latest = { ...r, result: merged ?? r.result };
    // Re-animate only when the answer changed. No answer: the card says it couldn't check.
    render(p, field, latest, !!merged && merged.verdict !== r.result.verdict, false, !merged);
  };
  let latest = res;
  const drained = drainer ? withDrainer(res) : Promise.resolve();
  // If only the creation date missed the time limit, ask once more in a moment (the worker
  // remembers the account) and fill it in quietly, keeping the drained-wallet answer.
  if (missingOptional(res.result)) {
    setTimeout(async () => {
      if (!current()) return;
      const again = await sendCheck({ ...req, refill: true }, LIMITS.pageWaitMs);
      if (!current() || !again.ok) return;
      await drained;
      if (!current()) return;
      // Keep a shown drained-wallet answer: merge it into the new result first (the worker's cache answers at once).
      const shown = latest.result.findings.some((f) => f.rule === "R18" && f.status !== "SKIPPED");
      if (!shown) return render(p, field, again, false);
      const merged = await sendDrainer(again.result, LIMITS.drainerWaitMs);
      if (!current()) return;
      latest = merged ? { ...again, result: merged } : latest;
      render(p, field, latest, false);
    }, LIMITS.refillAfterMs);
  }
}

function render(p: Panel, field: Field, res: Extract<CheckResponse, { ok: true }>, animate = true, drainerPending = false, drainerFailed = false): void {
  const r = res.result;
  const tone = toneOf(r);
  const held = r.verdict === "BLOCKED" && settings.holdSend;
  if (held) hold(p, field);
  else release(p);
  p.shown = { to: r.classification.normalized, network: r.input.network, verdict: r.verdict, ...(r.input.from ? { from: r.input.from } : {}) };
  lastShown = { field, value: p.value, ...p.shown };
  show(field, card(r, { held, actions: actionsFor(r, held), ...(res.net ? { net: res.net } : {}), ...(res.sender ? { sender: res.sender } : {}), ...(drainerPending ? { drainerPending } : {}), ...(drainerFailed ? { drainerFailed } : {}) }), tone, animate);
}

/* ---------- events ---------- */

function selectionText(target: EventTarget | null): string {
  if (isTextField(target)) {
    const f = target;
    const s = f.selectionStart ?? 0;
    const e = f.selectionEnd ?? 0;
    return f.value.slice(s, e);
  }
  return window.getSelection()?.toString() ?? "";
}

let lastSelection = "";
function onCopy(e: ClipboardEvent): void {
  if (!e.isTrusted) return;
  if (!settings.clipboardCheck) { watch.reset(); return; }
  // The selection is held only for this copy event (to spot a page swapping it), then dropped.
  // Only an address-shaped selection is remembered for the paste check (R9).
  lastSelection = selectionText(e.target);
  setTimeout(() => { lastSelection = ""; }, 0);
  const sel = lastSelection.trim();
  watch.recordCopy(addressLike(sel) ? sel : "");
}
function onCopyAfter(e: ClipboardEvent): void {
  if (!e.isTrusted) return;
  if (!settings.clipboardCheck) { lastSelection = ""; return; }
  let written: string | null = null;
  try {
    written = e.clipboardData?.getData("text/plain") ?? null;
  } catch {
    written = null;
  }
  const swapped = copyTampered(lastSelection, written, e.defaultPrevented);
  if (swapped) show(null, tamperCard(lastSelection, swapped), "block");
  lastSelection = "";
}
window.addEventListener("copy", onCopy, true);
window.addEventListener("cut", onCopy, true);
window.addEventListener("copy", onCopyAfter, false);
window.addEventListener("cut", onCopyAfter, false);
window.addEventListener("blur", () => watch.reset());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) watch.reset();
});

document.addEventListener("paste", (e) => {
  if (!e.isTrusted) return;
  if (!settings.checkOnPaste || !isTextField(e.target)) return;
  const field = e.target;
  const pasted = e.clipboardData?.getData("text/plain") ?? "";
  const copied = settings.clipboardCheck ? watch.copiedFor() : null;
  setTimeout(() => {
    const value = plainTrim(field.value || pasted);
    if (shouldCheck(field, value)) void run(field, value, copied);
  }, 0);
}, true);

const timers = new WeakMap<Field, number>();
document.addEventListener("input", (e) => {
  if (!e.isTrusted) return;
  if (!settings.checkOnPaste || !isTextField(e.target)) return;
  if ((e as InputEvent).inputType === "insertFromPaste") return; // handled by the paste listener
  const field = e.target;
  const value = plainTrim(field.value);
  if (!value) {
    if (panel?.field === field) hide();
    return;
  }
  if (!isRecipientField(field) && panel?.field !== field) return;
  clearTimeout(timers.get(field));
  timers.set(field, window.setTimeout(() => {
    const v = plainTrim(field.value);
    if (shouldCheck(field, v)) void run(field, v, null);
    else if (panel?.field === field) hide();
  }, LIMITS.debounceMs));
}, true);

/* ---------- wallet approval screens ---------- */

let approvalKey = "";
let approvalSeq = 0;
let approvalShown = false;
/** Failed tries for the request showing now; the next try waits longer (2 s, 4 s, 8 s … 30 s). */
let approvalTries = 0;
let retryTimer = 0;
const MAX_APPROVAL_TRIES = 6;

async function scanApproval(): Promise<void> {
  if (orphaned || !extensionAlive()) return;
  let found = null;
  try {
    found = findApproval(document, location.href);
  } catch {
    found = null;
  }
  if (!found) {
    // The approval screen went away (approved, rejected or navigated): take its card down.
    if (approvalShown && panel?.field === null) hide();
    approvalKey = "";
    approvalShown = false;
    return;
  }
  if (found.key === approvalKey) return;
  if (found.key !== lastFailedKey) approvalTries = 0;
  approvalKey = found.key;
  const seq = ++approvalSeq;
  const why0 = found.from === "url" ? "from the wallet link" : "from the approval screen";
  if (found.unreadable) {
    // Never "no problems found" for a request nobody could read.
    const r = unreadableRequest({ ...(found.network ? { network: found.network } : {}), wallet: found.unreadable === "wallet" });
    show(null, txCard(r, { ...(found.network ? { net: { network: found.network, why: why0 } } : {}), actions: '<button data-act="dismiss" class="g">Dismiss</button>' }), "warn");
    approvalShown = true;
    return;
  }
  const res = await sendTx({
    request: found.request, host: location.host,
    ...(found.network ? { network: found.network } : {}),
    ...(found.signerId ? { signerId: found.signerId } : {}),
    ...(found.origin ? { origin: found.origin } : {}),
    ...(found.from === "screen" ? { screenOnly: true } : {}),
  }, LIMITS.txWaitMs);
  if (seq !== approvalSeq || approvalKey !== found.key) return;
  if (!res.ok) {
    if (res.orphaned) {
      orphaned = true;
      show(null, updated(), "warn");
      approvalShown = true;
      return;
    }
    // Never silent: the request isn't checked, so say so, and try again with a growing wait.
    lastFailedKey = found.key;
    approvalTries++;
    const again = approvalTries < MAX_APPROVAL_TRIES;
    const r = unfinishedRequest({ ...(found.network ? { network: found.network } : {}) });
    show(null, txCard(r, { ...(found.network ? { net: { network: found.network, why: why0 } } : {}), actions: `<button data-act="retry-approval">Try again</button><button data-act="dismiss" class="g">Dismiss</button>` }), "warn");
    approvalShown = true;
    clearTimeout(retryTimer);
    if (again) {
      retryTimer = window.setTimeout(() => {
        if (approvalKey !== found.key) return;
        approvalKey = "";
        void scanApproval();
      }, Math.min(30_000, 2000 * 2 ** (approvalTries - 1)));
    }
    return;
  }
  lastFailedKey = "";
  approvalTries = 0;
  const r = res.result;
  // A green card only on a known wallet: any page can put a harmless request in its own address.
  if (r.verdict === "SAFE" && !greenAllowed(location.hostname)) {
    if (approvalShown && panel?.field === null) hide();
    approvalShown = false;
    return;
  }
  const tone = r.verdict === "BLOCKED" ? "block" : r.verdict === "SAFE" ? "safe" : "warn";
  const why = found.from === "url" ? "from the wallet link" : "from the approval screen";
  // Name the network only when the link or screen showed it.
  show(null, txCard(r, { ...(found.network ? { net: { network: found.network, why } } : {}), actions: '<button data-act="dismiss" class="g">Dismiss</button>' }), tone);
  approvalShown = true;
}

let lastFailedKey = "";
let approvalTimer = 0;
function scheduleApproval(): void {
  if (approvalTimer) return;
  approvalTimer = window.setTimeout(() => {
    approvalTimer = 0;
    void scanApproval();
  }, 400);
}
void scanApproval();
try {
  // Wallets are single-page apps: the approval screen appears and changes without a page load.
  new MutationObserver(scheduleApproval).observe(document.documentElement, { childList: true, subtree: true });
} catch {
  /* no observer: the address check above still ran */
}
window.addEventListener("popstate", scheduleApproval);
window.addEventListener("hashchange", scheduleApproval);
