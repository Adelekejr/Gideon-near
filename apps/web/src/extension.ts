import type { CheckResult } from "@gideon/core";
import { initChrome, stopper, esc, LOGO } from "./chrome";
import { getContacts } from "./state";
import { runCheck, CASES } from "./run";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
document.querySelectorAll(".logo-slot").forEach((s) => (s.outerHTML = LOGO));
initChrome("Extension");

const addr = $<HTMLInputElement>("addr"), gw = $("gw"), wd = $<HTMLButtonElement>("wd"), inbox = $("inbox");
const sc = $("sc"), ss = $("ss"), plast = $("plast"), ext = $("ext");
$("sv").textContent = String(getContacts().length);

const TRON_HASH = CASES.find((c) => c.id === "tron-hash")!.input.to;
const GOOD = CASES.find((c) => c.id === "safe")!.input.to;
let seq = 0;

async function run(v: string) {
  v = v.trim();
  if (!v) { gw.className = "gw"; wd.disabled = false; inbox.classList.remove("flag"); return; }
  const my = ++seq;
  wd.disabled = true;
  gw.innerHTML = `<div class="gh" style="background:var(--ink)">${stopper("idle")}<b>GIDEON</b><span>CHECKING…</span></div>`;
  gw.className = "gw show";
  let r: CheckResult;
  try {
    r = await runCheck({ to: v, network: "testnet", asset: { symbol: "NEAR" }, destination: "unknown", amount: "25", addressBook: getContacts() });
  } catch (e) {
    if (my !== seq) return;
    gw.innerHTML = `<div class="gh" style="background:var(--warn);color:#16120A">${stopper("block")}<b>GIDEON</b><span>◆ COULDN’T CHECK</span></div><div class="gb"><div class="gr">${esc((e as Error).message)}. Withdraw stays held until a check completes.</div></div>`;
    return;
  }
  if (my !== seq) return;
  sc.textContent = String(+sc.textContent! + 1);
  const v3 = r.verdict === "BLOCKED" ? "block" : r.verdict === "SAFE" ? "safe" : "warn";
  const h = r.headline;
  const chipTxt = { block: "BLOCKED", warn: "LOOK AGAIN", safe: "SAFE" }[v3];
  const shortAddr = r.input.to.length === 64 ? (r.input.to.match(/.{1,16}/g) ?? []).map(esc).join("<br>") : esc(r.input.to);
  plast.innerHTML = `<div class="lh"><span class="label">Last paste</span><span style="display:flex;gap:8px;align-items:center">${stopper(v3 === "safe" ? "safe" : "block")}<span class="chip ${v3}">${chipTxt}</span></span></div><div class="lb"><div class="addr">${shortAddr}</div><div style="font-weight:700;margin-top:8px;font-size:14px;line-height:1.3">${esc(h ? h.title : "Every check passed")}</div><div class="small" style="margin-top:3px">${v3 === "block" ? "Withdraw button held on this page." : v3 === "warn" ? "Withdraw allowed, but look again first." : `${r.sources.length} live lookups in ${r.ms} ms.`}</div></div>`;
  const report = `check.html?net=testnet&to=${encodeURIComponent(r.input.to)}&amount=25`;
  if (v3 === "safe") {
    inbox.classList.remove("flag"); wd.disabled = false;
    gw.innerHTML = `<div class="gh">${stopper("safe")}<b>GIDEON</b><span>● CLEARED</span></div><div class="gb" style="padding:10px 14px"><div class="gr" style="margin:0">${esc(r.input.to)} exists on NEAR testnet and every check passed. Withdraw is enabled.</div></div>`;
    gw.className = "gw ok show"; return;
  }
  if (v3 === "block") ss.textContent = String(+ss.textContent! + 1);
  inbox.classList.add("flag"); wd.disabled = v3 === "block";
  const evid = h?.evidence?.[0];
  gw.innerHTML = `<div class="gh"${v3 === "warn" ? ' style="background:var(--warn);color:#16120A"' : ""}>${stopper("block")}<b>GIDEON</b><span>${v3 === "block" ? "■ SEND HELD" : "◆ LOOK AGAIN"}</span></div><div class="gb"><div class="gt">${esc(h?.title)}</div><div class="gr">${esc(h?.detail)}</div>${evid ? `<div class="gf"><b>found →</b> ${esc(evid.label)}: ${esc(evid.value)}</div>` : ""}${h?.fix?.length ? `<div class="gf"><b>fix →</b> ${esc(h.fix[1] ?? h.fix[0])}</div>` : ""}<div class="ga"><button id="clr">Clear &amp; paste again</button><button class="g" id="full">Full report</button></div></div>`;
  gw.className = "gw show"; ext.classList.add("on");
  $("clr").onclick = () => { addr.value = ""; run(""); };
  $("full").onclick = () => { location.href = report; };
}
addr.addEventListener("paste", () => setTimeout(() => run(addr.value), 0));
addr.addEventListener("change", () => run(addr.value));
$("sim").onclick = $("pbtn").onclick = () => { addr.value = TRON_HASH; run(addr.value); };
$("sim2").onclick = () => { addr.value = GOOD; run(addr.value); };
if (location.hash === "#blocked") { addr.value = TRON_HASH; run(addr.value); }
if (location.hash === "#safe") { addr.value = GOOD; run(addr.value); }
