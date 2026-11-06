// Shared chrome for every page: light/dark theme, live watch log, big footer, reveals,
// and the Gate G that plays the result of a real check.
import "./styles/shift.css";
import "./styles/pages.css";
import { NETWORKS, STOP_LABEL, type Network } from "@gideon/core";
import { getNetwork, setNetwork } from "./state";

/** Brand mark: Gate G, static. The short bar is the G's crossbar. Red is reserved for a BLOCKED pose. */
export const LOGO = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M35.31 12.69A16 16 0 1 0 40 24" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/><rect x="22" y="20.5" width="18" height="7" fill="currentColor"/><circle cx="40" cy="24" r="4.6" fill="currentColor"/></svg>';

export const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;
export const STATIC = REDUCE || /static/.test(location.hash);

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/* ---------------- Gate G ---------------- */
export type StopState = "block" | "safe" | "warn" | "idle";
/** Gate G in a pose. idle = checking (the bar rocks); block/warn/safe = the final frame of playVerdict(). Pass "cnc" for couldn't-check (amber outline, never green). */
export function stopper(state: StopState, cls = ""): string {
  return `<svg class="gs ${state}${cls ? " " + cls : ""}" viewBox="0 0 48 48" overflow="visible" role="img" aria-label="${STOP_LABEL[state]}">
<path class="gs-arc" d="M35.31 12.69A16 16 0 1 0 40 24"/>
<rect class="gs-ghost" x="4.5" y="20.5" width="35.5" height="7" rx="3.5"/>
<rect class="gs-bar" x="4.5" y="20.5" width="35.5" height="7" rx="3.5"/>
<rect class="gs-out" x="6" y="22" width="32.5" height="4" rx="2"/>
<circle class="gs-pivot" cx="40" cy="24" r="4.6"/></svg>`;
}

export function verdictState(v: string | undefined): StopState {
  return v === "BLOCKED" ? "block" : v === "SAFE" ? "safe" : v ? "warn" : "idle";
}

const STOP = "cubic-bezier(.5,0,.9,.55)", OUT = "cubic-bezier(.2,.7,.3,1)", IO = "cubic-bezier(.4,0,.2,1)", SETTLE = "cubic-bezier(.2,.8,.2,1)";

function barAngle(el: SVGElement): number {
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return 0;
  const m = t.match(/matrix\(([^)]+)\)/);
  if (!m) return 0;
  const p = m[1].split(",").map((n) => parseFloat(n));
  if (p.length < 2 || Number.isNaN(p[0]) || Number.isNaN(p[1])) return 0;
  return Math.atan2(p[1], p[0]) * 180 / Math.PI;
}

/** Play a real verdict on a Gate G. The rock stops where it is and the verdict path starts from that angle.
 *  BLOCKED: the bar slams shut in red (1.0s). ATTENTION: it lifts to 45° in amber and blinks (0.9s).
 *  Couldn't check (class cnc): the same lift, then the fill empties to an amber outline. Never green.
 *  SAFE: the bar rises to 90° in green (1.1s). No tick. Reduced motion: the final pose only. */
export function playVerdict(svg: Element | null | undefined, state: StopState): Promise<void> {
  if (!svg) return Promise.resolve();
  const bar0 = svg.querySelector(".gs-bar") as SVGElement | null;
  const from = bar0 ? barAngle(bar0) : 0;
  svg.classList.remove("block", "safe", "warn", "idle");
  svg.classList.add(state);
  svg.setAttribute("aria-label", STOP_LABEL[state]);
  (svg as HTMLElement).dataset.played = "";
  const done = () => { (svg as HTMLElement).dataset.played = state; };
  const cnc = svg.classList.contains("cnc");
  if (REDUCE || state === "idle" || !("animate" in svg)) { done(); return Promise.resolve(); }
  const bar = svg.querySelector(".gs-bar") as SVGElement | null;
  const outline = svg.querySelector(".gs-out") as SVGElement | null;
  if (!bar) { done(); return Promise.resolve(); }
  const cs = getComputedStyle(svg);
  const red = cs.getPropertyValue("--b").trim() || "#D42A10";
  const amber = cs.getPropertyValue("--a").trim() || "#E8A400";
  const green = cs.getPropertyValue("--s").trim() || "#4FB57A";
  let a: Animation;
  if (state === "block") {
    bar.style.fill = red;
    a = bar.animate([
      { transform: `rotate(${from}deg)`, offset: 0, easing: STOP },
      { transform: "rotate(0deg)", offset: .6 },
      { transform: "rotate(3deg)", offset: .75, easing: SETTLE },
      { transform: "rotate(0deg)", offset: 1 },
    ], { duration: 1000, fill: "both" });
  } else if (state === "warn") {
    bar.style.fill = amber;
    a = bar.animate([
      { transform: `rotate(${from}deg)`, offset: 0, easing: OUT },
      { transform: "rotate(50deg)", offset: .42 },
      { transform: "rotate(45deg)", offset: .5 },
      { transform: "rotate(45deg)", offset: 1 },
    ], { duration: 900, fill: "both" });
    if (cnc && outline) {
      bar.animate([{ opacity: 1, offset: 0 }, { opacity: 1, offset: .55 }, { opacity: .35, offset: .7 }, { opacity: 0, offset: .9 }, { opacity: 0, offset: 1 }], { duration: 900, fill: "both" });
      outline.animate([{ opacity: 0, offset: 0 }, { opacity: 0, offset: .7 }, { opacity: 1, offset: .9 }, { opacity: 1, offset: 1 }], { duration: 900, fill: "both" });
    } else {
      bar.animate([{ opacity: 1, offset: .5 }, { opacity: .35, offset: .72 }, { opacity: 1, offset: 1 }], { duration: 900, fill: "both" });
    }
  } else {
    bar.style.fill = green;
    a = bar.animate([
      { transform: `rotate(${from}deg)`, offset: 0, easing: SETTLE },
      { transform: "rotate(90deg)", offset: 1 },
    ], { duration: 1100, fill: "both" });
  }
  return new Promise((res) => { a.onfinish = () => { done(); res(); }; a.oncancel = () => { done(); res(); }; });
}

/* ---------------- theme: one light, one dark, or the system setting ---------------- */
type Mode = "light" | "dark" | "system";
const BG: Record<"light" | "dark", string> = { light: "#F5F3EE", dark: "#0E0E0C" };
const KEY = "gideon:theme";
const OLD = "gideon:shift";
const R = document.documentElement;

export function systemTheme(): "light" | "dark" {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function readMode(): Mode {
  let m = "";
  try { m = localStorage.getItem(KEY) || ""; } catch { /* private mode */ }
  if (m === "light" || m === "dark" || m === "system") return m;
  let s = "";
  try { s = localStorage.getItem(OLD) || ""; } catch { /* private mode */ }
  if (s === "night" || s === "plan") return "dark";
  if (s === "day" || s === "signal") return "light";
  return "system";
}
function applyTheme(m: Mode) {
  const t = m === "system" ? systemTheme() : m;
  R.dataset.mode = m;
  R.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BG[t]);
  try { localStorage.setItem(KEY, m); } catch { /* private mode */ }
}

/** Approach, hard stop, small recoil, settle: the one motion the whole site uses. */
export function stopFrames(fmt: (v: number) => string, from: number, to: number, recoil: number): Keyframe[] {
  const dir = to > from ? 1 : -1;
  return [
    { transform: fmt(from), offset: 0, easing: STOP },
    { transform: fmt(to), offset: .62, easing: OUT },
    { transform: fmt(to - dir * recoil), offset: .8, easing: IO },
    { transform: fmt(to), offset: 1 },
  ];
}

function themeToggle(): string {
  return `<div class="tools">
<div class="seg" role="radiogroup" aria-label="Colour theme" id="themerail">
<button type="button" role="radio" data-m="light">Light</button>
<button type="button" role="radio" data-m="dark">Dark</button>
<button type="button" role="radio" data-m="system" title="Follow this device’s setting">Auto</button>
</div>
<div class="seg nets" role="group" aria-label="Network" id="netseg">
<button type="button" data-net="testnet" aria-pressed="false">Testnet</button>
<button type="button" data-net="mainnet" aria-pressed="false">Mainnet</button>
</div></div>`;
}

function initTheme() {
  const rail = document.getElementById("themerail");
  if (!rail) return;
  const btns = Array.from(rail.querySelectorAll("button")) as HTMLButtonElement[];
  const place = () => {
    const m = (R.dataset.mode as Mode) || "system";
    btns.forEach((b) => {
      const on = b.dataset.m === m;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    });
  };
  const set = (m: Mode) => {
    if (m === R.dataset.mode) return;
    applyTheme(m); place(); fitGiant();
  };
  btns.forEach((b) => b.addEventListener("click", () => set(b.dataset.m as Mode)));
  rail.addEventListener("keydown", (e) => {
    const order: Mode[] = ["light", "dark", "system"];
    let i = order.indexOf((R.dataset.mode as Mode) || "system");
    if (i < 0) i = 2;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") i = (i + 1) % 3;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") i = (i + 2) % 3;
    else return;
    e.preventDefault(); set(order[i]); btns[i].focus();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (R.dataset.mode === "system") { applyTheme("system"); place(); }
  });
  place();
  (window as unknown as { __gideon: object }).__gideon = { setTheme: (m: Mode) => { applyTheme(m); place(); fitGiant(); } };
}

/* ---------------- NEAR logo (official, unaltered: black on light, white on dark) ---------------- */
export function nearMark(h = 13): string {
  return `<span class="near-mark"><img class="on-light" src="/brand/near-logo-black.svg" alt="NEAR" style="height:${h}px;width:auto"><img class="on-dark" src="/brand/near-logo-white.svg" alt="NEAR" style="height:${h}px;width:auto"></span>`;
}

/* ---------------- watch log ---------------- */
const WATCH_KEY = "gideon.watch";
interface WatchItem { to: string; v: StopState; t: number; net?: string }
/** Remember a real check (this browser only) so it shows in the watch log as YOU. */
export function recordWatch(to: string, verdict: string, net?: string, replace = false) {
  try {
    const list: WatchItem[] = JSON.parse(localStorage.getItem(WATCH_KEY) ?? "[]");
    // A later answer for the same check (the drained-wallet check) updates its line instead of adding one.
    if (replace && list.length) list.shift();
    list.unshift({ to: to.length > 30 ? to.slice(0, 10) + "…" + to.slice(-8) : to, v: verdictState(verdict), t: Date.now(), net });
    localStorage.setItem(WATCH_KEY, JSON.stringify(list.slice(0, 6)));
  } catch { /* ignore */ }
}
function myChecks(): WatchItem[] {
  try { const l = JSON.parse(localStorage.getItem(WATCH_KEY) ?? "[]"); return Array.isArray(l) ? l.filter((x) => x && typeof x.to === "string") : []; } catch { return []; }
}
const VNAME: Record<StopState, string> = { block: "Blocked", warn: "Attention", safe: "Safe", idle: "—" };
// Clearly labelled sample traffic. Not real checks; real checks from this browser show as YOU.
const DEMO: [string, StopState][] = [["payroll.near", "safe"], ["northwind-payrol1.near", "block"], ["fresh-shop-77.testnet", "warn"], ["89a46298…f4126944 (tx hash)", "block"], ["0x5aAe…eAed", "warn"], ["v2.ref-finance.near", "safe"], ["alice.near on testnet", "block"], ["9f2c41e0…d17e9b04", "safe"]];

function watchStrip(): string {
  return `<div class="watch" data-state="connecting" aria-label="Watch log">
<div class="live"><span><span class="dot"></span><span class="wst">Connecting</span></span>
<span><span class="k">Block</span><span class="h" id="bh">—</span></span>
<span class="clk"><span class="k">Local</span><span class="tn" id="clk"></span></span>
<span class="near" title="Gideon checks sends on NEAR"><span class="k" style="margin:0">Built on</span>${nearMark(11)}</span></div>
<div class="feed" aria-live="off"><ol id="feed"></ol></div></div>`;
}

let pollTimer = 0, lastH = 0, fails = 0;
function startWatch() {
  const w = document.querySelector(".watch") as HTMLElement, st = w.querySelector(".wst") as HTMLElement, bh = document.getElementById("bh")!;
  const fbh = () => document.getElementById("fbh");
  const fmt = (n: number) => n.toLocaleString("en-US");
  const offline = () => { w.dataset.state = "offline"; st.textContent = "Offline"; if (!lastH) { bh.textContent = "no signal"; const f = fbh(); if (f) f.textContent = "block — (offline)"; } };
  const poll = async () => {
    const net = getNetwork();
    if (navigator.onLine === false) return offline();
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 5000);
    try {
      const r = await fetch(NETWORKS[net].rpcUrls[0], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "gideon-watch", method: "block", params: { finality: "final" } }), signal: ctl.signal });
      const j = await r.json(); const h = j?.result?.header;
      if (!h || net !== getNetwork()) throw 0;
      fails = 0; w.dataset.state = "live"; st.textContent = "Live";
      if (h.height !== lastH) {
        lastH = h.height; bh.textContent = fmt(h.height);
        const f = fbh(); if (f) f.textContent = `block ${fmt(h.height)} · ${net}`;
        if (!STATIC) bh.animate([{ transform: "translateY(-6px)", opacity: .2 }, { transform: "translateY(0)", opacity: 1, offset: .6 }, { transform: "translateY(-1.5px)", offset: .8 }, { transform: "translateY(0)" }], { duration: 420, easing: STOP });
      }
    } catch { if (++fails >= 2 || !navigator.onLine) offline(); }
    finally { clearTimeout(to); }
  };
  const restart = () => { lastH = 0; fails = 0; bh.textContent = "—"; w.dataset.state = "connecting"; st.textContent = "Connecting"; clearInterval(pollTimer); poll(); pollTimer = window.setInterval(poll, 4000); };
  addEventListener("online", poll); addEventListener("offline", offline);
  restart();
  const clk = document.getElementById("clk")!;
  const tick = () => { const s = new Date().toLocaleTimeString("en-GB", { hour12: false, timeZoneName: "short" }); clk.textContent = s; const f = document.getElementById("fclk"); if (f) f.textContent = s; };
  tick(); setInterval(tick, 1000);

  // feed: your real checks (YOU) mixed with sample traffic, always labelled DEMO
  const feed = document.getElementById("feed")!;
  const items: (WatchItem & { demo?: boolean })[] = myChecks().map((x) => ({ ...x }));
  let di = 0;
  const now = Date.now();
  for (let k = 0; k < Math.max(2, 5 - items.length); k++) { const [to, v] = DEMO[di++ % DEMO.length]; items.push({ to, v, t: now - (k * 9 + 4) * 1000, demo: true }); }
  items.sort((a, b) => b.t - a.t);
  const ago = (t: number) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };
  const li = (x: WatchItem & { demo?: boolean }) => `<li><span class="src${x.demo ? "" : " you"}">${x.demo ? "DEMO" : "YOU"}</span><span class="who">${esc(x.to)}</span><span class="chip ${x.v}">${VNAME[x.v]}</span><span class="ago tn" data-t="${x.t}">${ago(x.t)}</span></li>`;
  feed.innerHTML = items.slice(0, 6).map(li).join("");
  const ages = () => feed.querySelectorAll<HTMLElement>(".ago").forEach((e) => (e.textContent = ago(+e.dataset.t!)));
  if (!STATIC) setInterval(() => {
    const [to, v] = DEMO[di++ % DEMO.length];
    feed.insertAdjacentHTML("afterbegin", li({ to, v, t: Date.now(), demo: true }));
    while (feed.children.length > 6) feed.lastElementChild!.remove();
    const f = feed.firstElementChild as HTMLElement;
    f.animate(stopFrames((x) => `translateX(${x}px)`, -40, 0, 4).map((k, i) => ({ ...k, opacity: i ? 1 : 0 })), { duration: 520 });
    ages();
  }, 3200);
  setInterval(ages, 1000);
  return restart;
}

/* ---------------- header / footer ---------------- */
const PAGES: [string, string][] = [["index.html", "Checker"], ["send.html", "Send"], ["keys.html", "Account health"], ["extension.html", "Extension"], ["agents.html", "Agents"], ["docs.html", "Docs"]];
function header(on: string): string {
  return `<header class="top"><a class="brand" href="index.html" aria-label="Gideon home">${LOGO}<b>Gideon</b></a>
<nav class="links" aria-label="Primary">${PAGES.map(([h, t]) => `<a href="${h}"${t === on ? ' aria-current="page"' : ""}>${t}</a>`).join("")}</nav>${themeToggle()}</header>`;
}

function bigFooter(): string {
  const net = getNetwork();
  return `<footer class="big"><div class="ft-top">
<div><span class="lbl">Gideon</span>A pre-send checker for NEAR. It reads the address, token and destination before you sign and stops the mistakes wallets let through.<br><br>No keys. No custody. Read-only checks. <a class="inl" href="/PRIVACY.md">Privacy</a> · <a class="inl" href="/LICENSE.txt">MIT</a>.</div>
<div><span class="lbl">Doors</span><a href="index.html">Checker</a><a href="send.html">Send with a check</a><a href="keys.html">Account health</a><a href="extension.html">Browser extension</a><a href="agents.html">For AI agents</a><a href="docs.html">Docs</a></div>
<div><span class="lbl">Built on NEAR</span>${nearMark(22)}<span id="fbh" class="tn">block — · ${net}</span><br><span id="fclk" class="tn"></span></div>
</div>
<div class="giant" aria-hidden="true">${LOGO}<b>Gideon</b></div>
<div class="ft-base"><span>Check it before it leaves · started 29 Oct 2026</span><span>NEAR and the NEAR logo are trademarks of NEAR Foundation. Gideon shows the logo unaltered, only to say it is built on NEAR. Gideon is an independent project, not made or endorsed by NEAR Foundation.</span></div></footer>`;
}

/** Kept for pages that print a short line above the big footer. */
export function footer(left: string): string {
  return `<p class="small mono" style="margin-top:56px;border-top:1px solid var(--line);padding-top:14px">${left}</p>`;
}

function fitGiant() {
  const g = document.querySelector(".giant") as HTMLElement | null; if (!g) return;
  const b = g.querySelector("b") as HTMLElement, sv = g.querySelector("svg")!;
  b.style.fontSize = "";
  const avail = g.clientWidth - sv.getBoundingClientRect().width - parseFloat(getComputedStyle(g).columnGap || "0") - 2;
  const fs = parseFloat(getComputedStyle(b).fontSize);
  if (b.scrollWidth > 0) b.style.fontSize = fs * avail / b.scrollWidth + "px";
}

/* ---------------- reveals ---------------- */
let io: IntersectionObserver | null = null;
export function reveal(root: ParentNode = document) {
  const els = Array.from(root.querySelectorAll<HTMLElement>(".rv:not([data-rv])"));
  for (const el of els) {
    el.dataset.rv = "1";
    const sib = el.parentElement ? Array.from(el.parentElement.children).filter((c) => c.classList.contains("rv")) : [];
    el.dataset.i = String(Math.min(sib.indexOf(el), 5));
    if (io) io.observe(el); else el.classList.add("in");
  }
}

/** Press the network control that matches `net`. Used when an example runs on a fixed network. */
export function paintNetwork(net: Network): void {
  document.querySelectorAll<HTMLButtonElement>("#netseg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.net === net)));
}

export function initChrome(on: string, onNetworkChange?: () => void) {
  if (STATIC) R.classList.add("static");
  applyTheme(readMode());
  const net = getNetwork();
  const n = document.getElementById("nav");
  const top = header(on) + watchStrip();
  if (n) n.outerHTML = top; else document.body.insertAdjacentHTML("afterbegin", top);
  initTheme();
  paintNetwork(net);
  const restart = startWatch();
  document.getElementById("netseg")?.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    const value = b?.dataset.net as Network | undefined;
    if (!value || value === getNetwork()) return;
    setNetwork(value);
    // ?net= wins over the saved choice, so drop it from the URL once the user picks
    const u = new URL(location.href); if (u.searchParams.has("net")) { u.searchParams.delete("net"); history.replaceState(null, "", u); }
    paintNetwork(value);
    restart();
    onNetworkChange?.();
  });
  io = !STATIC && "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    const el = e.target as HTMLElement; io!.unobserve(el); el.classList.add("in");
    el.animate([{ transform: "translateY(28px)", opacity: 0 }, { transform: "translateY(0)", opacity: 1, offset: .62, easing: OUT }, { transform: "translateY(4px)", offset: .8 }, { transform: "translateY(0)", opacity: 1 }], { duration: 820, delay: (+el.dataset.i! || 0) * 70, fill: "backwards", easing: STOP });
  }), { rootMargin: "0px 0px -8% 0px" }) : null;
  reveal();
  addCopyButtons();
  if (!document.querySelector("footer.big")) document.body.insertAdjacentHTML("beforeend", bigFooter());
  fitGiant(); addEventListener("resize", fitGiant); document.fonts?.ready.then(fitGiant);
  // hero headline lines rise, stop, settle
  if (!STATIC) document.querySelectorAll<HTMLElement>(".mega .ln>span").forEach((s, i) => s.animate([{ transform: "translateY(105%)" }, { transform: "translateY(0)", offset: .62, easing: OUT }, { transform: "translateY(4px)", offset: .8 }, { transform: "translateY(0)" }], { duration: 900, delay: 120 + i * 90, fill: "backwards", easing: STOP }));
}

/** A Copy button on every code block, and wrapping so a long line doesn’t widen the page. */
function addCopyButtons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>(".code").forEach((el) => {
    if (el.closest(".codewrap")) return;
    const wrap = document.createElement("div");
    wrap.className = "codewrap";
    el.parentNode?.insertBefore(wrap, el);
    wrap.appendChild(el);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "codecopy";
    btn.setAttribute("aria-label", "Copy code");
    btn.textContent = "Copy";
    btn.addEventListener("click", async () => {
      const text = el.innerText.replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = "Copied";
      } catch {
        btn.textContent = "Select to copy";
      }
      window.setTimeout(() => { btn.textContent = "Copy"; }, 1600);
    });
    wrap.appendChild(btn);
  });
}

/** Torn receipt slip: perforated top, torn bottom, barcode drawn from the receipt hash. */
export function tearSlip(slip: HTMLElement, hash: string) {
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const pts: string[] = [];
  for (let x = 0; x <= 100; x += 2.5) pts.push(`${x}% ${(x / 2.5) % 2 ? 6 : 0}px`);
  for (let x = 100; x >= 0; x -= 1.6) pts.push(`${x.toFixed(1)}% calc(100% - ${(rnd() * 11).toFixed(1)}px)`);
  slip.style.clipPath = `polygon(${pts.join(",")})`;
  const bars = slip.querySelector(".bars");
  if (bars) bars.innerHTML = Array.from(hash.slice(0, 56)).map((c) => {
    const n = parseInt(c, 16);
    return `<i style="flex-grow:${Number.isNaN(n) ? 1 : 1 + (n % 3)}"></i>`;
  }).join("");
}
