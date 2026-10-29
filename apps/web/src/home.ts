import { exchangesFor, tokensFor, type Network } from "@gideon/core";
import { initChrome, stopper, esc } from "./chrome";
import { getNetwork, getContacts, saveContacts } from "./state";
import { CASES, CASE_LABELS } from "./run";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const assetSel = $<HTMLSelectElement>("asset"), destSel = $<HTMLSelectElement>("dest"), exSel = $<HTMLSelectElement>("exchange");

function fillForNetwork() {
  const net: Network = getNetwork();
  $("netchip").textContent = net;
  $("netchip").className = "chip " + (net === "mainnet" ? "warn" : "idle");
  $<HTMLInputElement>("net").value = net;
  $<HTMLInputElement>("to").placeholder = `name.${net === "mainnet" ? "near" : "testnet"}, 64-character account or 0x…`;
  $<HTMLInputElement>("from").placeholder = `you.${net === "mainnet" ? "near" : "testnet"}`;
  const toks = tokensFor(net);
  assetSel.innerHTML = `<option value="NEAR|">NEAR (native)</option>` +
    toks.map((t) => `<option value="${esc(t.symbol)}|${esc(t.contract)}">${esc(t.symbol)}${t.kind === "bridged" ? " (bridged)" : ""}</option>`).join("") +
    `<option value="other|">Other token…</option>`;
  exSel.innerHTML = exchangesFor(net).map((e) => `<option value="${esc(e.id)}">${esc(e.name)}${e.verified ? "" : " (unverified)"}</option>`).join("");
  sync();
}
function sync() {
  const [sym, contract] = assetSel.value.split("|");
  $<HTMLInputElement>("assetSym").value = sym === "other" ? "TOKEN" : sym;
  const ct = $<HTMLInputElement>("contract");
  $("ctf").classList.toggle("hidden", sym !== "other");
  if (sym !== "other") ct.value = contract;
  ct.disabled = false;
  $("exf").classList.toggle("hidden", destSel.value !== "exchange");
  exSel.disabled = destSel.value !== "exchange";
}
assetSel.addEventListener("change", sync);
destSel.addEventListener("change", sync);
$<HTMLFormElement>("f").addEventListener("submit", () => {
  // drop empty fields so the result URL stays short and shareable
  for (const el of Array.from($<HTMLFormElement>("f").elements) as HTMLInputElement[]) if (el.name && !el.value) el.disabled = true;
});

/* saved contacts (localStorage only) */
function renderContacts() {
  const c = getContacts();
  $("ccount").textContent = String(c.length);
  $("clist").innerHTML = c.length ? c.map((x, i) => `<li><span>${esc(x.account)}${x.label ? ` · <b>${esc(x.label)}</b>` : ""}</span><button type="button" data-i="${i}" aria-label="Remove">remove</button></li>`).join("")
    : `<li class="small">No contacts yet. Gideon compares every send to these to catch lookalikes.</li>`;
}
$("clist").addEventListener("click", (e) => {
  const i = (e.target as HTMLElement).dataset.i; if (i === undefined) return;
  const c = getContacts(); c.splice(+i, 1); saveContacts(c); renderContacts();
});
$("cadd").addEventListener("click", () => {
  const account = $<HTMLInputElement>("cacc").value.trim().toLowerCase(); if (!account) return;
  const label = $<HTMLInputElement>("clab").value.trim();
  const c = getContacts().filter((x) => x.account !== account); c.push({ account, ...(label ? { label } : {}) });
  saveContacts(c); $<HTMLInputElement>("cacc").value = ""; $<HTMLInputElement>("clab").value = ""; renderContacts();
});

/* real-world examples: each runs live */
const tries = $("tries");
for (const c of CASES) {
  const a = document.createElement("a");
  a.href = `check.html?example=${encodeURIComponent(c.id)}`;
  a.textContent = CASE_LABELS[c.id] ?? c.title; a.title = `${c.title} (${c.input.network})`;
  a.className = "try"; tries.appendChild(a);
}

/* hero loop: two real results from demo/cases.json */
const HL: [ "block" | "safe", string][] = [
  ["block", "send 120 NEAR → 89a46…126944<br><b>■ stopped</b> · Tron transaction hash, not an account<br>funds moved: 0"],
  ["safe", "send 10 NEAR → hammed-stampdue.testnet<br><b class=\"ok\">● cleared</b> · account exists, every check passed<br>receipt sha256 attached"],
];
let hi = 0;
function hero() { const [s, l] = HL[hi % 2]; $("hs").innerHTML = stopper(s); $("hlog").innerHTML = l; hi++; }
hero();
if (!matchMedia("(prefers-reduced-motion: reduce)").matches && location.hash !== "#static") setInterval(hero, 3600);

initChrome("Checker", fillForNetwork);
fillForNetwork();
renderContacts();
