import { addContact, load, saveContacts, withDefaults, type Settings } from "./lib/settings.js";
import { ClipboardWatch, copyTampered } from "./lib/clipboard.js";
import { findSendButtons, isRecipientField, isTextField, shouldCheck, type Field } from "./lib/detect.js";
import { card, checking, failed, tamperCard, toneOf } from "./lib/view.js";
import { STYLE, STYLE_WARN_FIX } from "./lib/style.js";
import { sendCheck } from "./lib/messages.js";
import { asShift, loadShift, themeOf, type Shift } from "./lib/shift.js";
import { playAll } from "./lib/motion.js";
import type { CheckResult, Contact } from "@gideon/core";

/*
 * Gideon content script. It only reacts to text you paste or type into a field that
 * looks like a send recipient (or to a value that can only be an address or hash),
 * sends that one value to the extension's service worker for checking, and shows the
 * result next to the field. It reads nothing else on the page.
 */

let settings: Settings = withDefaults({}).settings;
let contacts: Contact[] = [];
const watch = new ClipboardWatch();
let shift: Shift = "auto";
void loadShift().then((v) => (shift = v));

void load().then((s) => {
  settings = s.settings;
  contacts = s.contacts;
});
chrome.storage.onChanged.addListener((ch) => {
  if (ch.settings) settings = withDefaults({ settings: ch.settings.newValue }).settings;
  if (ch.shift) shift = asShift(ch.shift.newValue);
  if (ch.contacts) contacts = withDefaults({ contacts: ch.contacts.newValue }).contacts;
});

/* ---------- the warning panel, in a shadow root so the page can't restyle it ---------- */

const COLORS = { block: "#FF4D1A", warn: "#F4B400", safe: "#2DB36F", idle: "#8F8878" } as const;

interface Panel {
  host: HTMLElement;
  root: ShadowRoot;
  field: Field | null;
  seq: number;
  held: HTMLElement[];
  prevOutline: string;
}

let panel: Panel | null = null;
let fontsAdded = false;

function addFonts(): void {
  if (fontsAdded) return;
  fontsAdded = true;
  try {
    const s = document.createElement("style");
    s.id = "gideon-fonts";
    s.textContent = `@font-face{font-family:'Gideon Archivo';src:url(${chrome.runtime.getURL("fonts/Archivo.woff2")}) format('woff2');font-weight:100 900;font-stretch:62% 125%}
@font-face{font-family:'Gideon Mono';src:url(${chrome.runtime.getURL("fonts/JetBrainsMono.woff2")}) format('woff2');font-weight:100 800}`;
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
  panel = { host, root, field: null, seq: 0, held: [], prevOutline: "" };
  return panel;
}

function content(p: Panel): HTMLElement {
  return p.root.querySelector(".g-root") as HTMLElement;
}

function place(): void {
  const p = panel;
  if (!p || p.host.style.display === "none") return;
  if (p.field && !p.field.isConnected) return hide();
  if (p.field) {
    const r = p.field.getBoundingClientRect();
    const w = Math.max(300, Math.min(460, r.width));
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - w - 8));
    p.host.style.width = `${w}px`;
    p.host.style.left = `${left + window.scrollX}px`;
    p.host.style.top = `${r.bottom + window.scrollY + 8}px`;
  } else {
    p.host.style.width = "380px";
    p.host.style.left = `${window.scrollX + window.innerWidth - 396}px`;
    p.host.style.top = `${window.scrollY + 16}px`;
  }
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

function show(field: Field | null, html: string, tone: keyof typeof COLORS): void {
  const p = getPanel();
  if (p.field && p.field !== field) restoreOutline(p);
  if (field && p.field !== field) p.prevOutline = field.style.outline;
  p.field = field;
  const box = content(p);
  box.dataset.theme = themeOf(shift);
  box.innerHTML = html;
  p.host.style.display = "block";
  if (field) {
    field.style.outline = `2px solid ${COLORS[tone]}`;
    field.style.outlineOffset = "1px";
  }
  place();
  playAll(box);
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
  }
}, true);
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

async function run(field: Field, value: string, copied: string | null): Promise<void> {
  const p = getPanel();
  const seq = ++p.seq;
  release(p);
  show(field, checking(value), "idle");
  p.seq = seq;
  const res = await sendCheck({
    input: { to: value, ...(copied ? { clipboard: { copied } } : {}) },
    host: location.host,
  }).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
  if (p.seq !== seq || p.field !== field) return; // a newer check replaced this one
  if (!res || !res.ok) {
    show(field, failed(res?.error ?? "The extension didn't answer."), "warn");
    return;
  }
  const r = res.result;
  const tone = toneOf(r);
  const held = r.verdict === "BLOCKED" && settings.holdSend;
  if (held) hold(p, field);
  show(field, card(r, { held, actions: actionsFor(r, held) }), tone);
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
  lastSelection = selectionText(e.target);
  watch.recordCopy(lastSelection);
}
function onCopyAfter(e: ClipboardEvent): void {
  if (!settings.clipboardCheck) return;
  let written: string | null = null;
  try {
    written = e.clipboardData?.getData("text/plain") ?? null;
  } catch {
    written = null;
  }
  const swapped = copyTampered(lastSelection, written, e.defaultPrevented);
  if (swapped) show(null, tamperCard(lastSelection, swapped), "block");
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
  if (!settings.checkOnPaste || !isTextField(e.target)) return;
  const field = e.target;
  const pasted = e.clipboardData?.getData("text/plain") ?? "";
  const copied = settings.clipboardCheck ? watch.copiedFor() : null;
  setTimeout(() => {
    const value = (field.value || pasted).trim();
    if (shouldCheck(field, value)) void run(field, value, copied);
  }, 0);
}, true);

const timers = new WeakMap<Field, number>();
document.addEventListener("input", (e) => {
  if (!settings.checkOnPaste || !isTextField(e.target)) return;
  if ((e as InputEvent).inputType === "insertFromPaste") return; // handled by the paste listener
  const field = e.target;
  const value = field.value.trim();
  if (!value) {
    if (panel?.field === field) hide();
    return;
  }
  if (!isRecipientField(field) && panel?.field !== field) return;
  clearTimeout(timers.get(field));
  timers.set(field, window.setTimeout(() => {
    const v = field.value.trim();
    if (shouldCheck(field, v)) void run(field, v, null);
    else if (panel?.field === field) hide();
  }, 700));
}, true);
