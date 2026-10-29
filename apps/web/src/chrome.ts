// Direction C chrome: logo, animated stopper, nav, living background, night stages.
import "./styles/gideon.css";
import "./styles/mix.css";
import "./styles/site.css";
import { getNetwork, setNetwork } from "./state";

/** Brand v2, mark 1: the stopped send. */
export const LOGO = '<svg viewBox="0 0 88 88" aria-hidden="true"><rect x="4" y="38" width="44" height="12" fill="currentColor"/><path d="M44 24 L66 44 L44 64 Z" fill="currentColor"/><rect class="lw" x="71" y="10" width="11" height="68" fill="#FF4D1A"/></svg>';

export type StopState = "block" | "safe" | "idle";
/** Animated mark: "block" = arrow bounces off the wall; "safe" = wall lifts and the arrow passes. */
export function stopper(state: StopState, cls = ""): string {
  const label = state === "block" ? "Send stopped" : state === "safe" ? "Send cleared" : "Gideon";
  return `<svg class="gs ${state} ${cls}" viewBox="0 0 200 88" aria-label="${label}" role="img">
<g class="gs-arw"><rect x="6" y="38" width="112" height="12"/><path d="M114 24 L136 44 L114 64 Z"/></g>
<g class="gs-hit"><path d="M140 18 l-7 -9 M140 70 l-7 9 M128 14 l-2 -10 M128 74 l-2 10"/></g>
<rect class="gs-wall" x="146" y="10" width="11" height="68"/></svg>`;
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
