import { exchangesFor, tokensFor, type CheckInput, type Contact, type Network } from "@gideon/core";
import { addContact, load, removeContact, saveContacts, saveSettings, type LastCheck, type Settings } from "./lib/settings.js";
import { sendCheck, type CheckRequest } from "./lib/messages.js";
import type { NetworkMode } from "./lib/network.js";
import { card, checking, esc, failed, LOGO, short } from "./lib/view.js";
import { STYLE, STYLE_WARN_FIX } from "./lib/style.js";
import { POPUP_STYLE } from "./lib/popup-style.js";
import { asShift, loadShift, saveShift, SHIFTS, SHIFT_NAMES, themeOf, type Shift } from "./lib/shift.js";
import { playAll } from "./lib/motion.js";

const css = document.createElement("style");
css.textContent = STYLE + STYLE_WARN_FIX + POPUP_STYLE;
document.head.appendChild(css);

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const net = $<HTMLSelectElement>("net");
const asset = $<HTMLSelectElement>("asset");
const dest = $<HTMLSelectElement>("dest");
const exSel = $<HTMLSelectElement>("exchange");
let contacts: Contact[] = [];

$("logo").innerHTML = LOGO;

/* ---------- colour shift (same four as the website, plus AUTO) ---------- */
const app = $("app");
const rail = $("shiftrail");
rail.innerHTML = SHIFTS.map(([s, t]) => `<button type="button" role="radio" data-s="${s}" aria-checked="false" title="${s === "auto" ? "Follows this device's clock: Day from 06:00, Night Watch from 18:30" : SHIFT_NAMES[s as Exclude<Shift, "auto">]}">${t}</button>`).join("");
function applyShift(s: Shift): void {
  const t = themeOf(s);
  app.dataset.theme = t;
  app.dataset.shift = s;
  document.documentElement.dataset.theme = t;
  rail.querySelectorAll("button").forEach((b) => { b.setAttribute("aria-checked", String(b.dataset.s === s)); b.tabIndex = b.dataset.s === s ? 0 : -1; });
  $("autonote").textContent = s === "auto" ? `Auto → ${SHIFT_NAMES[t]}\n${t === "night" ? "day from 06:00" : "night from 18:30"}` : SHIFT_NAMES[t];
  $("autonote").style.whiteSpace = "pre";
  try { localStorage.setItem("gideon:shift", s); } catch { /* fine */ }
}
let cached: Shift = "auto";
try { cached = asShift(localStorage.getItem("gideon:shift")); } catch { /* fine */ }
applyShift(cached);
void loadShift().then((s) => { if (s !== cached) applyShift(s); });
rail.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (!b) return;
  const s = asShift(b.dataset.s);
  applyShift(s);
  void saveShift(s);
});
rail.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const list = SHIFTS.map(([s]) => s);
  const cur = list.indexOf(asShift(app.dataset.shift ?? rail.querySelector('[aria-checked="true"]')?.getAttribute("data-s")));
  const next = list[(cur + (e.key === "ArrowRight" ? 1 : list.length - 1)) % list.length]!;
  applyShift(next); void saveShift(next);
  (rail.querySelector(`[data-s="${next}"]`) as HTMLElement).focus();
});
$("ver").textContent = `v${chrome.runtime.getManifest().version}`;

/**
 * Asset options carry their network ("mainnet|USDT|usdt.tether-token.near"), so in Auto a token
 * you pick also tells Gideon the network. Native NEAR has none: Auto then goes by the address.
 */
function fillForNetwork(n: NetworkMode): void {
  net.value = n;
  net.parentElement!.classList.toggle("main", n === "mainnet");
  const nets: Network[] = n === "auto" ? ["mainnet", "testnet"] : [n];
  asset.innerHTML =
    `<option value="|NEAR|">NEAR (native)</option>` +
    nets.flatMap((m) => tokensFor(m).map((t) => `<option value="${m}|${esc(t.symbol)}|${esc(t.contract)}">${esc(t.symbol)}${t.kind === "bridged" ? " (bridged)" : ""}${n === "auto" ? ` · ${m}` : ""}</option>`)).join("");
  exSel.innerHTML = exchangesFor(n === "auto" ? "mainnet" : n).map((e) => `<option value="${esc(e.id)}">${esc(e.name)}${e.verified ? "" : " (unverified)"}</option>`).join("");
}
dest.addEventListener("change", () => exSel.classList.toggle("hidden", dest.value !== "exchange"));

function renderLast(l: LastCheck | null): void {
  if (!l) {
    $("last").innerHTML = `Nothing checked on a page yet. Paste an address into a send or withdrawal form and Gideon checks it there.`;
    return;
  }
  const tone = l.verdict === "BLOCKED" ? "block" : l.verdict === "SAFE" ? "safe" : "warn";
  const label = l.verdict === "BLOCKED" ? "STOPPED" : l.verdict === "SAFE" ? "LOOKS RIGHT" : l.couldNotCheck ? "COULDN’T CHECK" : "LOOK AGAIN";
  const when = new Date(l.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("last").innerHTML = `<div class="h"><span>${esc(l.host || "this browser")} · ${esc(when)}</span><span class="chip ${tone}">${label}</span></div>
<div class="mono">${esc(short(l.to))}</div><div class="t">${esc(l.title)}</div>`;
}

function renderContacts(): void {
  $("ccount").textContent = String(contacts.length);
  $("sSaved").textContent = String(contacts.length);
  $("clist").innerHTML = contacts.length
    ? contacts.map((c, i) => `<li><span>${esc(c.account)}${c.label ? ` · <b>${esc(c.label)}</b>` : ""}</span><button type="button" data-i="${i}" aria-label="Remove ${esc(c.account)}">remove</button></li>`).join("")
    : `<li><span class="hint">No saved addresses yet.</span></li>`;
}

async function init(): Promise<void> {
  const s = await load();
  contacts = s.contacts;
  fillForNetwork(s.settings.networkMode);
  for (const k of ["checkOnPaste", "holdSend", "clipboardCheck"] as const) {
    const box = $<HTMLInputElement>(k);
    box.checked = s.settings[k];
    box.addEventListener("change", () => void saveSettings({ [k]: box.checked } as Partial<Settings>));
  }
  $("sChecked").textContent = String(s.stats.checked);
  $("sStopped").textContent = String(s.stats.stopped);
  renderLast(s.last);
  renderContacts();
}

net.addEventListener("change", () => {
  const n = net.value as NetworkMode;
  fillForNetwork(n);
  void saveSettings({ networkMode: n });
  $("result").innerHTML = "";
});

$("clist").addEventListener("click", (e) => {
  const i = (e.target as HTMLElement).dataset.i;
  if (i === undefined) return;
  contacts = removeContact(contacts, contacts[+i]!.account);
  void saveContacts(contacts);
  renderContacts();
});
$("cadd").addEventListener("click", () => {
  const acc = $<HTMLInputElement>("cacc").value.trim();
  if (!acc) return;
  contacts = addContact(contacts, acc, $<HTMLInputElement>("clab").value.trim() || undefined);
  void saveContacts(contacts);
  $<HTMLInputElement>("cacc").value = "";
  $<HTMLInputElement>("clab").value = "";
  renderContacts();
});

$<HTMLFormElement>("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const to = $<HTMLInputElement>("to").value.trim();
  if (!to) return;
  const [tokenNet, symbol, contract] = asset.value.split("|");
  const mode = net.value as NetworkMode;
  const chosen = mode !== "auto" ? mode : (tokenNet as Network | "") || undefined;
  const input: CheckRequest["input"] = {
    to,
    ...(chosen ? { network: chosen } : {}),
    asset: { symbol: symbol!, ...(contract ? { contract } : {}) },
    destination: dest.value as CheckInput["destination"],
    ...(dest.value === "exchange" ? { exchange: exSel.value } : {}),
    ...($<HTMLInputElement>("amount").value.trim() ? { amount: $<HTMLInputElement>("amount").value.trim() } : {}),
  };
  const go = $<HTMLButtonElement>("go");
  go.disabled = true;
  go.firstChild!.textContent = "Checking live NEAR data… ";
  $("result").innerHTML = checking(to);
  const res = await sendCheck({ input, host: "" }).catch((err: unknown) => ({ ok: false as const, error: String(err) }));
  go.disabled = false;
  go.firstChild!.textContent = "Check this send ";
  $("result").innerHTML = res?.ok ? card(res.result, res.net ? { net: res.net } : {}) : failed(res?.error ?? "The extension didn't answer.");
  playAll($("result"));
  const s = await load();
  $("sChecked").textContent = String(s.stats.checked);
  $("sStopped").textContent = String(s.stats.stopped);
});

void init();
