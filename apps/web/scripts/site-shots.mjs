// Screenshots of the built site (apps/web/dist) in every shift, plus Arrow G frames on real results.
// Needs `npm run build:web` and playwright-core with Chromium. Checks run live on NEAR testnet
// except check.html?example=…, which replays the recorded answers in demo/fixtures.json.
//   node apps/web/scripts/site-shots.mjs [outDir]
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const OUT = process.argv[2] ?? "/tmp/gideon-site-shots";
mkdirSync(join(OUT, "frames"), { recursive: true });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  let p = join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
  if (!p.startsWith(dist) || !existsSync(p)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream" }).end(readFileSync(p));
}).listen(8767, "127.0.0.1");
const B = "http://127.0.0.1:8767/";
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const DESK = { width: 1440, height: 900 }, MOB = { width: 390, height: 844 };

async function open(url, { shift = "auto", vp = DESK, scale = 1, init } = {}) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: scale, isMobile: vp === MOB, hasTouch: vp === MOB });
  await ctx.addInitScript((s) => { try { localStorage.setItem("gideon:shift", s); } catch {} }, shift);
  // Records every WAAPI animation so the Arrow G can be stepped frame by frame.
  await ctx.addInitScript(() => { const o = Element.prototype.animate; window.__anims = []; Element.prototype.animate = function (...a) { const x = o.apply(this, a); window.__anims.push(x); return x; }; });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  await page.goto(B + url, { waitUntil: "load" });
  return page;
}
const played = (page, sel, timeout = 30000) => page.waitForFunction((s) => { const g = document.querySelector(s); return g && ["block", "warn", "safe"].includes(g.dataset.played); }, sel, { timeout });
async function scrollAll(page) {
  const h = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < h; y += 500) { await page.evaluate((y) => scrollTo(0, y), y); await page.waitForTimeout(90); }
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(400);
}
async function shot(page, name, full = false) {
  if (full) await scrollAll(page);
  await page.screenshot({ path: join(OUT, name), fullPage: full });
  console.log("saved", name);
  await page.context().close();
}

const SHIFTS = ["day", "night", "plan", "signal"];
// Home: the hero runs a real lookalike check on load and the Arrow G plays the result.
for (const s of SHIFTS) {
  for (const [vp, tag] of [[DESK, "desktop"], [MOB, "mobile"]]) {
    const p = await open("index.html", { shift: s, vp });
    await played(p, "#hs .gs"); await p.waitForTimeout(300);
    await shot(p, `home-${s}-${tag}.png`);
  }
}
{ const p = await open("index.html", { shift: "night" }); await played(p, "#hs .gs"); await shot(p, "desktop-home.png", true); }
{ const p = await open("index.html", { shift: "day", vp: MOB }); await played(p, "#hs .gs"); await shot(p, "mobile-home.png", true); }

// Results on the check page: BLOCKED, ATTENTION, SAFE (recorded answers), plus live ones.
const CHECKS = [
  ["check.html?example=lookalike", "desktop-check-blocked-lookalike.png", "night"],
  ["check.html?example=tron-hash", "desktop-check-blocked-tron-hash.png", "night"],
  ["check.html?example=evm-address", "desktop-check-attention.png", "night"],
  ["check.html?example=safe", "desktop-check-safe.png", "night"],
  ["check.html?example=lookalike", "day-check-blocked.png", "day"],
  ["check.html?example=evm-address", "plan-check-attention.png", "plan"],
  ["check.html?example=safe", "signal-check-safe.png", "signal"],
  ["check.html?net=testnet&to=no-such-account-gideon-404.testnet&amount=5", "desktop-check-blocked-nonexistent.png", "night"],
];
for (const [u, n, s] of CHECKS) { const p = await open(u, { shift: s }); await played(p, ".vstage .gs"); await p.waitForTimeout(300); await shot(p, n, true); }
{ const p = await open("check.html?example=lookalike", { vp: MOB, shift: "night" }); await played(p, ".vstage .gs"); await shot(p, "mobile-check-blocked.png", true); }
{ const p = await open("check.html?example=safe", { vp: MOB, shift: "day" }); await played(p, ".vstage .gs"); await shot(p, "mobile-check-safe.png", true); }
{ // every lookup fails: must say couldn't check, never safe
  const p = await open("check.html?net=testnet&to=ghost-account-1234.testnet", { shift: "night" });
  await p.route((u) => !u.hostname.startsWith("127.0.0.1"), (r) => r.abort());
  await p.reload(); await played(p, ".vstage .gs"); await shot(p, "desktop-check-couldnt-check.png", true);
}

// Arrow G frames on real results: step the recorded animations.
for (const [ex, st] of [["lookalike", "block"], ["evm-address", "warn"], ["safe", "safe"]]) {
  const p = await open(`check.html?example=${ex}`, { shift: "night", scale: 2 });
  await played(p, ".vstage .gs"); await p.waitForTimeout(1300);
  const stage = p.locator(".vstage").first();
  await stage.scrollIntoViewIfNeeded();
  for (const t of [0, 200, 400, 600, 800, 1100]) {
    await p.evaluate((t) => window.__anims.filter((a) => a.effect?.target?.closest?.(".vstage")).forEach((a) => { a.pause(); a.currentTime = Math.min(t, a.effect.getTiming().duration); }), t);
    await p.waitForTimeout(60);
    await stage.screenshot({ path: join(OUT, "frames", `${st}-${String(t).padStart(4, "0")}.png`) });
  }
  console.log("frames", st);
  await p.context().close();
}

// Send, extension demo and agents pages.
{ const p = await open("extension.html#lookalike", { shift: "night" }); await p.waitForTimeout(6000); await shot(p, "desktop-extension-blocked.png", true); }
{ const p = await open("extension.html#safe", { shift: "day" }); await p.waitForTimeout(6000); await shot(p, "desktop-extension-safe.png", true); }
{ const p = await open("extension.html#attention", { shift: "plan" }); await p.waitForTimeout(6000); await shot(p, "desktop-extension-attention.png"); }
{ const p = await open("extension.html#blocked", { shift: "day", vp: MOB }); await p.waitForTimeout(6000); await shot(p, "mobile-extension.png", true); }
{ const p = await open("agents.html", { shift: "night" }); await p.waitForTimeout(11000); await shot(p, "desktop-agents.png", true); }
{ const p = await open("agents.html", { shift: "signal", vp: MOB }); await p.waitForTimeout(11000); await shot(p, "mobile-agents.png", true); }
// Reduced motion: final pose only, no movement.
{ const ctx = await browser.newContext({ viewport: DESK, reducedMotion: "reduce" }); const p = await ctx.newPage(); await p.goto(B + "check.html?example=lookalike"); await played(p, ".vstage .gs"); await p.screenshot({ path: join(OUT, "reduced-motion-check-blocked.png") }); console.log("saved reduced-motion-check-blocked.png", await p.evaluate(() => document.getAnimations().length), "animations"); await ctx.close(); }

await browser.close();
server.close();
