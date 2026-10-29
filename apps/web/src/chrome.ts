// Direction C chrome: logo, animated stopper, nav, living background, night stages.
import "./styles/gideon.css";
import "./styles/mix.css";
import "./styles/site.css";
import { getNetwork, setNetwork } from "./state";

/** Brand mark: the Arrow G. The G's crossbar is the send arrow; the vermilion spur is the wall. */
export const LOGO = '<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="78" y="29" width="13" height="21" fill="#FF4D1A"/><rect x="28" y="33.5" width="25" height="13" fill="currentColor"/><path d="M52 26 L72 40 L52 54 Z" fill="currentColor"/><path d="M68.28 20.74 A34.5 34.5 0 1 0 84.5 50" fill="none" stroke="currentColor" stroke-width="13"/></svg>';

export type StopState = "block" | "safe" | "idle";
/** Animated Arrow G: "block" = the arrow hits the vermilion wall and bounces back;
 *  "safe" = the wall slides down into the G and the arrow leaves through the opening. */
let gsN = 0;
export function stopper(state: StopState, cls = ""): string {
  const label = state === "block" ? "Send stopped" : state === "safe" ? "Send cleared" : "Gideon";
  const id = `gsc${(++gsN).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `<svg class="gs ${state} ${cls}" viewBox="0 0 100 100" role="img" aria-label="${label}">
<defs><clipPath id="${id}"><rect x="70" y="0" width="30" height="50"/></clipPath></defs>
<g clip-path="url(#${id})"><rect class="gs-wall" x="78" y="29" width="13" height="21"/></g>
<g class="gs-arw"><rect x="28" y="33.5" width="25" height="13"/><path d="M52 26 L72 40 L52 54 Z"/></g>
<path class="gs-g" d="M68.28 20.74 A34.5 34.5 0 1 0 84.5 50"/>
<path class="gs-hit" d="M75 27 l-5 -5 M75 52 l-5 5 M84 25 v-6"/></svg>`;
}

const PAGES: [string, string][] = [["index.html", "Checker"], ["send.html", "Send"], ["extension.html", "Extension"], ["agents.html", "Agents"]];

function nav(on: string): string {
  const net = getNetwork();
  return `<div class="wrap"><nav class="nav"><a class="brand" href="index.html">${LOGO}<b>GIDEON</b></a>
<div class="links">${PAGES.map(([h, t]) => `<a href="${h}" class="${t === on ? "on" : ""}">${t}</a>`).join("")}</div>
<div class="navr"><label class="pill netpill" title="Network for checks"><i class="${net}"></i><select id="netsel" aria-label="Network">
<option value="testnet"${net === "testnet" ? " selected" : ""}>NEAR testnet</option><option value="mainnet"${net === "mainnet" ? " selected" : ""}>NEAR mainnet</option></select></label>
<a class="btn sm" href="index.html#check">Check a send</a></div></nav></div>`;
}

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const STAGES = ".hero,.ahero,.verdict,.popup,.gw";
function stage(el: Element) {
  if (el.classList.contains("zn")) return;
  el.classList.add("zn");
  if (el.matches(".gw")) return;
  const b = document.createElement("div");
  b.className = "nb";
  b.innerHTML = '<div class="nb-dots"></div><div class="nb-torch"></div>' + (el.matches(".hero,.ahero") ? '<div class="nb-scan"></div>' : "");
  el.prepend(b);
}
function stageAll() {
  document.querySelectorAll(STAGES).forEach(stage);
  document.querySelectorAll(".hero .checker").forEach((c) => c.classList.add("zp"));
}

export function initChrome(on: string, onNetworkChange?: () => void) {
  const n = document.getElementById("nav");
  if (n) n.outerHTML = nav(on);
  const sel = document.getElementById("netsel") as HTMLSelectElement | null;
  sel?.addEventListener("change", () => {
    setNetwork(sel.value as "testnet" | "mainnet");
    document.querySelectorAll(".netpill i").forEach((i) => (i.className = sel.value));
    onNetworkChange?.();
  });
  const bg = document.createElement("div");
  bg.className = "bg";
  bg.innerHTML = '<div class="bg-grid"></div><div class="bg-scan"></div>';
  document.body.prepend(bg);
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    let t = 0;
    addEventListener("scroll", () => {
      if (t) return;
      t = requestAnimationFrame(() => { bg.style.setProperty("--sy", (-(scrollY * 0.12) % 48).toFixed(1) + "px"); t = 0; });
    }, { passive: true });
  }
  stageAll();
  new MutationObserver(stageAll).observe(document.body, { childList: true, subtree: true });
}

export function footer(left: string): string {
  return `<footer><span>${left}</span><span>no keys · no custody · read-only checks · MIT</span></footer>`;
}
