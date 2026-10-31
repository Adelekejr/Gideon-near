import { exchangesFor, tokensFor, type Network } from "@gideon/core";
import { initChrome, stopper, esc, playVerdict, verdictState, tearSlip, LOGO } from "./chrome";
import type { CheckResult } from "@gideon/core";
import { getNetwork, getContacts, saveContacts } from "./state";
import { CASES, CASE_LABELS, runCheck } from "./run";
import { HOME_CHIP } from "./verdict-text";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const assetSel = $<HTMLSelectElement>("asset"), destSel = $<HTMLSelectElement>("dest"), exSel = $<HTMLSelectElement>("exchange");

function fillForNetwork() {
  const net: Network = getNetwork();
  $("netchip").textContent = net;
  $("netchip").className = "chip idle";
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

/* hero stage: each button runs the REAL engine on a stable case and the Arrow G plays the verdict it returns */
const CHIP: Record<string, string> = HOME_CHIP;
const stage = $("hs"), hlog = $("hlog");
const runBtns = Array.from(document.querySelectorAll<HTMLButtonElement>("#motif [data-case]"));
let stageBusy = false;
async function runStage(id: string) {
  const c = CASES.find((x) => x.id === id); if (!c || stageBusy) return;
  stageBusy = true;
  runBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.case === id)));
  stage.innerHTML = stopper("idle");
  hlog.innerHTML = `<span class="mute">Checking on NEAR ${esc(c.input.network)}…</span><br><span class="who">${esc(c.input.to)}</span>`;
  let r: CheckResult, recorded = false;
  try {
    r = await runCheck(structuredClone(c.input));
    if (r.sources.some((s) => !s.ok && !s.optional)) throw new Error("source failed");
  } catch {
    r = await runCheck(structuredClone(c.input), true); recorded = true;
  }
  const st = verdictState(r.verdict);
  hlog.innerHTML = `<span class="who">${esc(r.input.amount ?? "")} ${esc(r.input.asset.symbol)} → ${esc(r.input.to)}</span><br><span class="chip ${st}">${CHIP[r.verdict] ?? r.verdict}</span><br>${esc(r.headline?.title ?? (r.account?.summary || "Account exists. Every check passed."))}<br><span class="mute">${recorded ? "recorded answer (network unreachable)" : `live · ${r.ms} ms`} · <a href="check.html?example=${esc(id)}" style="text-decoration:underline">full report</a></span>`;
  await playVerdict(stage.querySelector(".gs"), st);
  stageBusy = false;
}
runBtns.forEach((b) => b.addEventListener("click", () => void runStage(b.dataset.case!)));
stage.innerHTML = stopper("idle");
hlog.innerHTML = `<span class="mute">Pick a send below. Gideon checks it for real and the arrow shows the verdict.</span>`;
if (!/nostage/.test(location.hash)) void runStage("lookalike");

/* receipt slip: a real result, replayed from recorded data so it never changes */
async function slip() {
  const c = CASES.find((x) => x.id === "lookalike"); if (!c) return;
  const r = await runCheck(structuredClone(c.input), true);
  const RN: Record<string, string> = { R1: "format", R2: "pasted hash", R3: "account", R5: "token", R7: "lookalike", R11: "account age" };
  const rows = r.findings.filter((f) => f.status !== "SKIPPED" && RN[f.rule]).slice(0, 6)
    .map((f) => `<div class="rule"><span>${RN[f.rule]}</span><span class="dots"></span><span>${f.status === "PASS" ? "ok" : f.status === "BLOCKED" ? "BLOCK" : f.status === "ATTENTION" ? "look" : "n/c"}</span></div>`).join("");
  $("slipbody").innerHTML = `<h4>${LOGO}GIDEON</h4><div class="sub">Pre-send receipt · NEAR ${esc(r.input.network)}</div><hr>
<div class="kv"><span>to</span><span>${esc(r.input.to)}</span><span>amount</span><span>${esc(r.input.amount ?? "")} ${esc(r.input.asset.symbol)}</span><span>engine</span><span>${esc(r.engine)}</span></div><hr>${rows}<hr>
<div class="vd"><span>VERDICT</span><span class="chip ${verdictState(r.verdict)}">${CHIP[r.verdict] ?? r.verdict}</span></div><p style="margin-top:8px">${esc(r.headline?.title ?? "")}</p><hr>
<div class="hash">sha256 ${esc(r.receipt.sha256)}</div><div class="bars"></div>`;
  tearSlip($("slip"), r.receipt.sha256);
}
void slip();

initChrome("Checker", fillForNetwork);
fillForNetwork();
renderContacts();
