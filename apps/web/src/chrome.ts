// Shared chrome for every page: shift lever + gate wipe, live watch log, grain, big footer, reveals,
// and the Arrow G stopper that plays the result of a real check.
import "./styles/shift.css";
import "./styles/pages.css";
import { NETWORKS, type Network } from "@gideon/core";
import { getNetwork, setNetwork } from "./state";

/** Brand mark: the Arrow G. The G's crossbar is the send arrow; the vermilion spur is the wall (the brand's one red). */
export const LOGO = '<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="78" y="29" width="13" height="21" fill="#FF4D1A"/><rect x="28" y="33.5" width="25" height="13" fill="currentColor"/><path d="M52 26 L72 40 L52 54 Z" fill="currentColor"/><path d="M68.28 20.74 A34.5 34.5 0 1 0 84.5 50" fill="none" stroke="currentColor" stroke-width="13"/></svg>';

export const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;
export const STATIC = REDUCE || /static/.test(location.hash);

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/* ---------------- Arrow G stopper ---------------- */
export type StopState = "block" | "safe" | "warn" | "idle";
const STOP_LABEL: Record<StopState, string> = { block: "Send stopped at the wall", warn: "Send held at the wall, look again", safe: "Wall open, send cleared", idle: "Checking" };
let gsN = 0;
/** Arrow G in a pose. idle = waiting (arrow breathes); block/warn/safe = the final frame of playVerdict(). */
export function stopper(state: StopState, cls = ""): string {
  const id = `gsc${(++gsN).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `<svg class="gs ${state} ${cls}" viewBox="0 0 100 100" role="img" aria-label="${STOP_LABEL[state]}">
<defs><clipPath id="${id}"><rect x="70" y="0" width="30" height="50"/></clipPath></defs>
<g clip-path="url(#${id})"><rect class="gs-wall" x="78" y="29" width="13" height="21"/></g>
<g class="gs-arw"><rect x="28" y="33.5" width="25" height="13"/><path d="M52 26 L72 40 L52 54 Z"/></g>
<path class="gs-g" d="M68.28 20.74 A34.5 34.5 0 1 0 84.5 50"/>
<path class="gs-hit" d="M74 26 l-5 -5 M74 54 l-5 5 M84.5 25 v-7"/></svg>`;
}

export function verdictState(v: string | undefined): StopState {
  return v === "BLOCKED" ? "block" : v === "SAFE" ? "safe" : v ? "warn" : "idle";
}

const STOP = "cubic-bezier(.5,0,.9,.55)", OUT = "cubic-bezier(.2,.7,.3,1)", IO = "cubic-bezier(.4,0,.2,1)";
/** Play a real verdict on an Arrow G. BLOCKED: the arrow hits the wall and bounces (1.0s).
 *  ATTENTION: the arrow stops short of an amber wall and waits; it never passes (0.9s).
 *  SAFE: the wall drops open and the arrow passes through (1.1s). Reduced motion: final pose only. */
export function playVerdict(svg: Element | null | undefined, state: StopState): Promise<void> {
  if (!svg) return Promise.resolve();
  svg.classList.remove("block", "safe", "warn", "idle");
  svg.classList.add(state);
  svg.setAttribute("aria-label", STOP_LABEL[state]);
  (svg as HTMLElement).dataset.played = "";
  const done = () => { (svg as HTMLElement).dataset.played = state; };
  if (REDUCE || state === "idle" || !("animate" in svg)) { done(); return Promise.resolve(); }
  const arw = svg.querySelector(".gs-arw") as SVGElement, wall = svg.querySelector(".gs-wall") as SVGElement, hit = svg.querySelector(".gs-hit") as SVGElement;
  const mute = getComputedStyle(svg).getPropertyValue("--mute").trim() || "#8F8878";
  let a: Animation;
  if (state === "block") {
    a = arw.animate([
      { transform: "translateX(0px)" },
      { transform: "translateX(-16px)", offset: .25, easing: STOP },
      { transform: "translateX(6px)", offset: .55, easing: OUT },
      { transform: "translateX(-6px)", offset: .74, easing: IO },
      { transform: "translateX(-4px)" },
    ], { duration: 1000 });
    wall.animate([{ transform: "translateX(0)", fill: mute }, { transform: "translateX(0)", fill: mute, offset: .54 }, { transform: "translateX(1.8px)", fill: "#FF4D1A", offset: .58 }, { transform: "translateX(-.7px)", offset: .7 }, { transform: "translateX(0)", fill: "#FF4D1A" }], { duration: 1000 });
    hit.animate([{ opacity: 0 }, { opacity: 0, offset: .55 }, { opacity: 1, offset: .6 }, { opacity: 1 }], { duration: 1000 });
  } else if (state === "warn") {
    a = arw.animate([
      { transform: "translateX(0px)" },
      { transform: "translateX(-14px)", offset: .28, easing: STOP },
      { transform: "translateX(5px)", offset: .6, easing: OUT },
      { transform: "translateX(3px)", offset: .78, easing: IO },
      { transform: "translateX(4px)" },
    ], { duration: 900 });
    wall.animate([{ fill: mute, opacity: 1 }, { fill: "#F4B400", opacity: 1, offset: .58 }, { opacity: .45, offset: .74 }, { opacity: 1, offset: .86 }, { opacity: .55, offset: .94 }, { fill: "#F4B400", opacity: 1 }], { duration: 900 });
  } else {
    wall.animate([
      { transform: "translateY(0)", opacity: 1, fill: mute },
      { transform: "translateY(0)", opacity: 1, fill: "#2DB36F", offset: .12, easing: STOP },
      { transform: "translateY(30px)", opacity: 0, fill: "#2DB36F", offset: .34 },
      { transform: "translateY(30px)", opacity: 0, fill: "#2DB36F" },
    ], { duration: 1100 });
    a = arw.animate([
      { transform: "translateX(0px)", opacity: 1 },
      { transform: "translateX(0px)", opacity: 1, offset: .2, easing: STOP },
      { transform: "translateX(70px)", opacity: 0, offset: .52 },
      { transform: "translateX(-30px)", opacity: 0, offset: .53, easing: OUT },
      { transform: "translateX(2px)", opacity: 1, offset: .86, easing: IO },
      { transform: "translateX(0px)", opacity: 1 },
    ], { duration: 1100 });
  }
  return new Promise((res) => { a.onfinish = () => { done(); res(); }; a.oncancel = () => { done(); res(); }; });
}

/* ---------------- shifts ---------------- */
type Shift = "day" | "night" | "plan" | "signal" | "auto";
const SHIFTS: [Shift, string][] = [["day", "DAY"], ["night", "NIGHT"], ["plan", "PLAN"], ["signal", "SIGNAL"], ["auto", "AUTO"]];
const NAMES: Record<string, string> = { day: "Day Shift", night: "Night Watch", plan: "Blueprint", signal: "Signal Box" };
const BG: Record<string, string> = { day: "#F2F0EB", night: "#0C0B09", plan: "#10283F", signal: "#FFFFFF" };
const KEY = "gideon:shift";
const R = document.documentElement;
/** AUTO follows the clock on this device: Day Shift from 06:00, Night Watch from 18:30. Plan and Signal are manual picks. */
export function autoTheme(d = new Date()): "day" | "night" {
  const m = d.getHours() * 60 + d.getMinutes();
  return m >= 18 * 60 + 30 || m < 6 * 60 ? "night" : "day";
}
function applyShift(s: Shift) {
  const t = s === "auto" ? autoTheme() : s;
  R.dataset.shift = s; R.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BG[t]);
  try { localStorage.setItem(KEY, s); } catch { /* private mode */ }
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

function lever(): string {
  return `<div class="lever"><span class="lbl">Shift</span>
<div class="rail" role="radiogroup" aria-label="Colour shift">${SHIFTS.map(([s, t]) => `<button type="button" role="radio" data-s="${s}" aria-checked="false" title="${s === "auto" ? "Follows your clock: Day from 06:00, Night Watch from 18:30" : NAMES[s]}">${t}</button>`).join("")}<span class="handle" aria-hidden="true"></span></div>
<span class="autonote" aria-live="polite"></span></div>`;
}

function initLever() {
  const rail = document.querySelector(".rail") as HTMLElement, handle = rail.querySelector(".handle") as HTMLElement;
  const btns = Array.from(rail.querySelectorAll("button")) as HTMLButtonElement[];
  const note = document.querySelector(".autonote") as HTMLElement;
  const gate = document.createElement("div");
  gate.className = "gate"; gate.setAttribute("aria-hidden", "true");
  gate.innerHTML = '<div class="pnl"><span class="edge"></span><span class="tag"></span></div>';
  document.body.appendChild(gate);
  const pnl = gate.firstElementChild as HTMLElement, tag = pnl.querySelector(".tag") as HTMLElement;

  const place = (animate: boolean) => {
    const s = R.dataset.shift ?? "auto", b = rail.querySelector(`[data-s="${s}"]`) as HTMLElement;
    if (!b) return;
    btns.forEach((x) => { x.setAttribute("aria-checked", String(x === b)); x.tabIndex = x === b ? 0 : -1; });
    const x = b.offsetLeft, prev = parseFloat(handle.dataset.x ?? String(x));
    handle.style.width = b.offsetWidth + "px"; handle.style.transform = `translateX(${x}px)`; handle.dataset.x = String(x);
    if (animate && !REDUCE && prev !== x) handle.animate(stopFrames((v) => `translateX(${v}px)`, prev, x, 4), { duration: 520 });
    note.textContent = s === "auto" ? `Auto → ${NAMES[R.dataset.theme ?? "day"]}` : NAMES[s];
  };
  let busy = false;
  const set = (s: Shift) => {
    if (busy || s === R.dataset.shift) return;
    const t = s === "auto" ? autoTheme() : s;
    if (REDUCE || t === R.dataset.theme) { applyShift(s); place(true); return; }
    busy = true;
    pnl.style.background = BG[t]; pnl.style.color = t === "day" || t === "signal" ? "#111210" : "#EFE8D8";
    tag.textContent = NAMES[t] + " ▸";
    gate.style.display = "block";
    R.dataset.shift = s; place(true);
    const a = pnl.animate(stopFrames((v) => `translateX(${v}px)`, -innerWidth, 0, 4), { duration: 620, fill: "forwards" });
    a.onfinish = () => {
      applyShift(s); place(false); fitGiant();
      const b = pnl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: "ease-out", fill: "forwards" });
      b.onfinish = () => { gate.style.display = "none"; a.cancel(); b.cancel(); busy = false; };
    };
  };
  btns.forEach((b) => b.addEventListener("click", () => set(b.dataset.s as Shift)));
  rail.addEventListener("keydown", (e) => {
    let i = btns.findIndex((b) => b.getAttribute("aria-checked") === "true");
    if (e.key === "ArrowRight" || e.key === "ArrowDown") i = (i + 1) % 5;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") i = (i + 4) % 5;
    else return;
    e.preventDefault(); btns[i].focus(); set(btns[i].dataset.s as Shift);
  });
  addEventListener("resize", () => place(false));
  setInterval(() => { if (R.dataset.shift === "auto" && autoTheme() !== R.dataset.theme) { applyShift("auto"); place(false); } }, 60000);
  document.fonts?.ready.then(() => place(false));
  place(false);
  (window as unknown as { __gideon: object }).__gideon = { setShift: (s: Shift) => { applyShift(s); place(false); fitGiant(); } };
}

/* ---------------- NEAR logo (official, unaltered: black on light shifts, white on dark) ---------------- */
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

function watchStrip(net: Network): string {
  return `<div class="watch" data-state="connecting" aria-label="Watch log">
<div class="live"><span><span class="dot"></span><span class="wst">Connecting</span></span>
<label class="netsel" title="Network Gideon checks against"><i class="${net}"></i><select id="netsel" aria-label="Network"><option value="testnet"${net === "testnet" ? " selected" : ""}>Testnet</option><option value="mainnet"${net === "mainnet" ? " selected" : ""}>Mainnet</option></select></label>
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
const PAGES: [string, string][] = [["index.html", "Checker"], ["send.html", "Send"], ["keys.html", "Account health"], ["extension.html", "Extension"], ["agents.html", "Agents"]];
function header(on: string): string {
  return `<header class="top"><a class="brand" href="index.html" aria-label="Gideon home">${LOGO}<b>GIDEON</b></a>
<nav class="links" aria-label="Primary">${PAGES.map(([h, t]) => `<a href="${h}"${t === on ? ' aria-current="page"' : ""}>${t}</a>`).join("")}</nav>${lever()}</header>`;
}

function bigFooter(): string {
  const net = getNetwork();
  return `<footer class="big"><div class="ft-top">
<div><span class="lbl">Gideon</span>A pre-send checker for NEAR. It reads the address, token and destination before you sign and stops the mistakes wallets let through.<br><br>No keys. No custody. Read-only checks. MIT.</div>
<div><span class="lbl">Doors</span><a href="index.html">Checker</a><a href="send.html">Send with a check</a><a href="keys.html">Account health</a><a href="extension.html">Browser extension</a><a href="agents.html">For AI agents</a></div>
<div><span class="lbl">Shifts</span>Day · Night Watch · Blueprint · Signal Box.<br>AUTO follows this device's clock: Day Shift from 06:00, Night Watch from 18:30. Plan and Signal are manual picks.<br><b>Vermilion means blocked. Nothing else.</b></div>
<div><span class="lbl">Built on NEAR</span>${nearMark(22)}<span id="fbh" class="tn">block — · ${net}</span><br><span id="fclk" class="tn"></span></div>
</div>
<div class="giant" aria-hidden="true">${LOGO}<b>GIDEON</b></div>
<div class="ft-base"><span>Check it before it leaves · started 29 Oct 2026</span><span>NEAR and the NEAR logo are trademarks of NEAR Foundation</span></div></footer>`;
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
  b.style.fontSize = fs * avail / b.scrollWidth + "px";
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

export function initChrome(on: string, onNetworkChange?: () => void) {
  if (STATIC) R.classList.add("static");
  const net = getNetwork();
  const n = document.getElementById("nav");
  const top = header(on) + watchStrip(net);
  if (n) n.outerHTML = top; else document.body.insertAdjacentHTML("afterbegin", top);
  const grain = document.createElement("div"); grain.className = "grain"; grain.setAttribute("aria-hidden", "true");
  document.body.prepend(grain);
  if (!document.querySelector("footer.big")) document.body.insertAdjacentHTML("beforeend", bigFooter());
  initLever();
  const restart = startWatch();
  const sel = document.getElementById("netsel") as HTMLSelectElement;
  sel.addEventListener("change", () => {
    setNetwork(sel.value as Network);
    // ?net= wins over the saved choice, so drop it from the URL once the user picks
    const u = new URL(location.href); if (u.searchParams.has("net")) { u.searchParams.delete("net"); history.replaceState(null, "", u); }
    document.querySelectorAll(".netsel i").forEach((i) => (i.className = sel.value));
    restart();
    onNetworkChange?.();
  });
  io = !STATIC && "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    const el = e.target as HTMLElement; io!.unobserve(el); el.classList.add("in");
    el.animate([{ transform: "translateY(28px)", opacity: 0 }, { transform: "translateY(0)", opacity: 1, offset: .62, easing: OUT }, { transform: "translateY(4px)", offset: .8 }, { transform: "translateY(0)", opacity: 1 }], { duration: 820, delay: (+el.dataset.i! || 0) * 70, fill: "backwards", easing: STOP });
  }), { rootMargin: "0px 0px -8% 0px" }) : null;
  reveal();
  fitGiant(); addEventListener("resize", fitGiant); document.fonts?.ready.then(fitGiant);
  // hero headline lines rise, stop, settle
  if (!STATIC) document.querySelectorAll<HTMLElement>(".mega .ln>span").forEach((s, i) => s.animate([{ transform: "translateY(105%)" }, { transform: "translateY(0)", offset: .62, easing: OUT }, { transform: "translateY(4px)", offset: .8 }, { transform: "translateY(0)" }], { duration: 900, delay: 120 + i * 90, fill: "backwards", easing: STOP }));
}

/** Torn receipt slip: perforated top, torn bottom, barcode drawn from the receipt hash. */
export function tearSlip(slip: HTMLElement, hash: string) {
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const pts: string[] = [];
  for (let x = 0; x <= 100; x += 2.5) pts.push(`${x}% ${(x / 2.5) % 2 ? 6 : 0}px`);
  for (let x = 100; x >= 0; x -= 1.6) pts.push(`${x.toFixed(1)}% calc(100% - ${(rnd() * 11).toFixed(1)}px)`);
  slip.style.clipPath = `polygon(${pts.join(",")})`;
  const bars = slip.querySelector(".bars");
  if (bars) bars.innerHTML = Array.from(hash.slice(0, 64)).map((c) => { const n = parseInt(c, 16) || 0; return `<i style="width:${1 + n % 3}px;margin-right:${1 + (n >> 2) % 3}px"></i>`; }).join("");
}
