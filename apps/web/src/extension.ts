import type { CheckResult } from "@gideon/core";
import { initChrome, esc, LOGO } from "./chrome";
import { getContacts } from "./state";
import { runCheck, CASES } from "./run";
// The demo uses the extension's own card, styles and motion, so the page shows exactly what the extension draws.
import { STYLE } from "../../extension/src/lib/style";
import { POPUP_STYLE } from "../../extension/src/lib/popup-style";
import { card, checking, failed, toneOf, statusLabel, titleOf, short } from "../../extension/src/lib/view";
import { playAll } from "../../extension/src/lib/motion";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
document.querySelectorAll(".logo-slot").forEach((s) => (s.outerHTML = LOGO));
initChrome("Extension");

// Inside the site the extension's font names resolve to the site's copies of the same files.
const FONTS = `.g-root{--display:'Archivo',system-ui,sans-serif;--mono:'JB Mono',ui-monospace,Menlo,monospace}`;
const theme = () => document.documentElement.dataset.theme || "night";
function shadow(host: HTMLElement, css: string, cls: string): HTMLElement {
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${css}${FONTS}.g-root{display:block}</style><div class="g-root ${cls}" data-theme="${theme()}"></div>`;
  return root.querySelector(".g-root") as HTMLElement;
}
const gwRoot = shadow($("gw"), STYLE, "");
const popCss = POPUP_STYLE.replace(/@font-face\{[^}]*\}/g, "").replace(/html[^{]*\{[^}]*\}/g, "");
const pop = shadow($("pop"), STYLE + popCss + ".pp{width:100%;max-width:380px;border:1px solid var(--line);border-radius:4px;box-shadow:0 30px 60px -30px rgba(0,0,0,.5)}", "pp");
pop.innerHTML = `<header class="top"><span class="logo">${LOGO}</span><b class="word">GIDEON</b><label class="net"><span class="dot"></span><select aria-label="Network" disabled><option>testnet</option></select></label></header>
<div class="shifts"><div class="rail" role="radiogroup" aria-label="Colour shift" id="rail"></div><span class="autonote" id="note"></span></div>
<section class="sec"><div class="lab">LAST CHECK ON A PAGE</div><div class="last" id="plast">Nothing checked on a page yet. Paste an address into the form and Gideon checks it there.</div></section>
<div class="sec res" id="pres"></div>
<section class="stats"><div><b id="sc">0</b><span>CHECKED</span></div><div><b id="ss" class="v">0</b><span>STOPPED</span></div><div><b id="sv">0</b><span>SAVED</span></div></section>
<section class="sec"><div class="lab">ON WALLET &amp; EXCHANGE PAGES</div>
<label class="tg"><input type="checkbox" checked disabled><i></i><span>Check recipient fields on paste and typing</span></label>
<label class="tg"><input type="checkbox" checked disabled><i></i><span>Hold the Send button while a check says <b class="v">STOPPED</b></span></label>
<label class="tg"><input type="checkbox" checked disabled><i></i><span>Compare what I copied with what I paste (R9)</span></label></section>
<footer class="foot"><span class="built">Built on <img class="near on-dark" src="/brand/near-logo-white.svg" alt="NEAR"><img class="near on-light" src="/brand/near-logo-black.svg" alt="NEAR"></span><span>read-only · no keys · 0.2.3</span></footer>`;
const q = <T extends HTMLElement>(id: string) => pop.querySelector("#" + id) as T;

// Popup shift picker: the same five choices as the real popup, wired to this site's shift.
const SH: [string, string][] = [["auto", "AUTO"], ["day", "DAY"], ["night", "NIGHT"], ["plan", "PLAN"], ["signal", "SIGNAL"]];
const NAMES: Record<string, string> = { day: "Day Shift", night: "Night Watch", plan: "Blueprint", signal: "Signal Box" };
const rail = q("rail");
rail.innerHTML = SH.map(([s, t]) => `<button type="button" role="radio" data-s="${s}" aria-checked="false">${t}</button>`).join("");
function syncShift() {
  const t = theme(), s = document.documentElement.dataset.shift || "auto";
  gwRoot.dataset.theme = pop.dataset.theme = t;
  rail.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.s === s)));
  q("note").textContent = s === "auto" ? `Auto → ${NAMES[t]}\n${t === "night" ? "day from 06:00" : "night from 18:30"}` : "manual";
  q("note").style.whiteSpace = "pre";
}
rail.addEventListener("click", (e) => {
  const s = (e.target as HTMLElement).closest("button")?.dataset.s;
  const g = (window as unknown as { __gideon?: { setShift(s: string): void } }).__gideon;
  if (s && g) g.setShift(s);
});
new MutationObserver(syncShift).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-shift"] });
syncShift();

const addr = $<HTMLInputElement>("addr"), wd = $<HTMLButtonElement>("wd"), inbox = $("inbox"), ext = $("ext");
q("sv").textContent = String(getContacts().length);
const caseOf = (id: string) => CASES.find((c) => c.id === id)!.input;
const TRON_HASH = caseOf("tron-hash").to, GOOD = caseOf("safe").to;
const LOOK = caseOf("lookalike"), EVM = caseOf("evm-address");
let seq = 0, extraBook: { account: string; label?: string }[] = [];

async function run(v: string) {
  v = v.trim();
  const my = ++seq;
  inbox.className = "in"; ext.className = "ext";
  if (!v) { gwRoot.innerHTML = ""; wd.disabled = false; return; }
  wd.disabled = true;
  gwRoot.innerHTML = checking(v);
  let r: CheckResult;
  try {
    const book = [...getContacts(), ...extraBook];
    r = await runCheck({ to: v, network: "testnet", asset: { symbol: "NEAR" }, destination: "unknown", amount: "25", addressBook: book as never });
  } catch (e) {
    if (my !== seq) return;
    gwRoot.innerHTML = failed(`${(e as Error).message}.`);
    playAll(gwRoot);
    return;
  }
  if (my !== seq) return;
  const tone = toneOf(r);
  q("sc").textContent = String(+q("sc").textContent! + 1);
  if (tone === "block") q("ss").textContent = String(+q("ss").textContent! + 1);
  const report = `check.html?net=testnet&to=${encodeURIComponent(r.input.to)}&amount=25`;
  const actions = tone === "safe" ? "" : `<button id="clr">Clear &amp; paste again</button><button class="g" id="full">Full report</button>`;
  gwRoot.innerHTML = card(r, { held: tone === "block", actions });
  playAll(gwRoot); // the real result plays: bounce, hold or pass
  wd.disabled = tone === "block";
  if (tone !== "safe") { inbox.className = `in flag t-${tone}`; ext.className = `ext on t-${tone}`; }
  q("plast").innerHTML = `<div class="h"><span>northwind.example · just now</span><span class="chip ${tone}">${esc(statusLabel(r, tone === "block"))}</span></div><div class="t">${esc(titleOf(r))}</div><div class="mono" style="margin-top:4px;font-size:11.5px;color:var(--mute)">${esc(short(r.input.to))}</div>`;
  gwRoot.querySelector<HTMLButtonElement>("#clr")?.addEventListener("click", () => { addr.value = ""; extraBook = []; run(""); });
  gwRoot.querySelector<HTMLButtonElement>("#full")?.addEventListener("click", () => { location.href = report; });
}
const paste = (v: string, book: { account: string; label?: string }[] = []) => { extraBook = book; addr.value = v; run(v); };
addr.addEventListener("paste", () => setTimeout(() => { extraBook = []; run(addr.value); }, 0));
addr.addEventListener("change", () => { extraBook = []; run(addr.value); });
$("sim").onclick = $("pbtn").onclick = () => paste(TRON_HASH);
$("sim2").onclick = () => paste(GOOD);
$("sim3").onclick = () => paste(LOOK.to, LOOK.addressBook ?? []);
$("sim4").onclick = () => paste(EVM.to);
const h = location.hash;
if (h === "#blocked") paste(TRON_HASH);
if (h === "#safe") paste(GOOD);
if (h === "#lookalike") paste(LOOK.to, LOOK.addressBook ?? []);
if (h === "#attention") paste(EVM.to);
