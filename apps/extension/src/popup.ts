import { exchangesFor, tokensFor, type CheckInput, type Contact, type Network } from "@gideon/core";
import { addContact, load, removeContact, saveContacts, saveSettings, type LastCheck, type Settings } from "./lib/settings.js";
import { sendCheck, type CheckRequest } from "./lib/messages.js";
import { card, esc, failed, LOGO, short } from "./lib/view.js";
import { STYLE, STYLE_WARN_FIX } from "./lib/style.js";
import { POPUP_STYLE } from "./lib/popup-style.js";

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
$("ver").textContent = `v${chrome.runtime.getManifest().version}`;

function fillForNetwork(n: Network): void {
  net.value = n;
  net.parentElement!.classList.toggle("main", n === "mainnet");
  asset.innerHTML =
    `<option value="NEAR|">NEAR (native)</option>` +
    tokensFor(n).map((t) => `<option value="${esc(t.symbol)}|${esc(t.contract)}">${esc(t.symbol)}${t.kind === "bridged" ? " (bridged)" : ""}</option>`).join("");
  exSel.innerHTML = exchangesFor(n).map((e) => `<option value="${esc(e.id)}">${esc(e.name)}${e.verified ? "" : " (unverified)"}</option>`).join("");
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
  fillForNetwork(s.settings.network);
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
  const n = net.value as Network;
  fillForNetwork(n);
  void saveSettings({ network: n });
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
  const [symbol, contract] = asset.value.split("|");
  const input: CheckRequest["input"] = {
    to,
    network: net.value as Network,
    asset: { symbol: symbol!, ...(contract ? { contract } : {}) },
    destination: dest.value as CheckInput["destination"],
    ...(dest.value === "exchange" ? { exchange: exSel.value } : {}),
    ...($<HTMLInputElement>("amount").value.trim() ? { amount: $<HTMLInputElement>("amount").value.trim() } : {}),
  };
  const go = $<HTMLButtonElement>("go");
  go.disabled = true;
  go.firstChild!.textContent = "Checking live data ";
  const res = await sendCheck({ input, host: "" }).catch((err: unknown) => ({ ok: false as const, error: String(err) }));
  go.disabled = false;
  go.firstChild!.textContent = "Check this send ";
  $("result").innerHTML = res?.ok ? card(res.result) : failed(res?.error ?? "The extension didn't answer.");
  const s = await load();
  $("sChecked").textContent = String(s.stats.checked);
  $("sStopped").textContent = String(s.stats.stopped);
});

void init();
