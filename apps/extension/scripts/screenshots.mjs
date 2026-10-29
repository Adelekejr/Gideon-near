// Loads dist/ into Playwright's Chromium, runs it against test-page/withdraw.html and
// saves screenshots. Not part of the build: needs `npm i -D playwright-core` and
// `npx playwright install chromium` (branded Chrome 137+ ignores --load-extension).
//   node scripts/screenshots.mjs [all|block|safe|hijack|popup] [outDir]
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(here, "dist");
const OUT = process.argv[3] ?? join(tmpdir(), "gideon-extension-shots");
mkdirSync(OUT, { recursive: true });
const server = createServer((req, res) => {
  if (!req.url.startsWith("/withdraw.html")) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": "text/html" }).end(readFileSync(join(here, "test-page/withdraw.html")));
}).listen(8765, "127.0.0.1");
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "gideon-ext-")), {
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--headless=new"],
  viewport: { width: 900, height: 760 }, deviceScaleFactor: 2,
  permissions: ["clipboard-read", "clipboard-write"],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
const id = new URL(sw.url()).host;
console.log("extension id", id);
const which = process.argv[2] ?? "all";
const page = await ctx.newPage();
const base = "http://127.0.0.1:8765/withdraw.html";

async function copyFromBox(p) {
  await p.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById("src")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await p.keyboard.press("Control+C");
  await p.waitForTimeout(300);
}
async function pasteInto(p) {
  await p.click("#addr");
  await p.keyboard.press("Control+V");
}
async function waitVerdict(p) {
  await p.waitForFunction(() => document.querySelector("gideon-watch")?.style.display === "block", null, { timeout: 5000 });
  await p.waitForTimeout(9000);
}
async function clip(p, name) {
  const box = await p.locator("main").boundingBox();
  await p.screenshot({ path: `${OUT}/${name}.png`, clip: { x: box.x - 20, y: box.y - 20, width: box.width + 40, height: Math.min(720, box.height + 300) } });
  console.log("shot", name, await p.evaluate(() => document.getElementById("send").disabled));
}

if (which === "all" || which === "block") {
  await page.goto(base + "?src=89a46298b5f72a95c3205ec6dfc2e842860f1faf24e701de2ae03418f4126944");
  await copyFromBox(page); await pasteInto(page); await waitVerdict(page);
  console.log("value", await page.inputValue("#addr"));
  await clip(page, "extension-warning-blocked");
}
if (which === "all" || which === "safe") {
  await page.goto(base);
  await copyFromBox(page); await pasteInto(page); await waitVerdict(page);
  await clip(page, "extension-warning-safe");
}
if (which === "all" || which === "hijack") {
  await page.goto(base + "?hijack=1");
  await copyFromBox(page);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/extension-clipboard-tamper-copy.png` });
  await pasteInto(page); await waitVerdict(page);
  await clip(page, "extension-clipboard-tamper");
}
if (which === "all" || which === "offline") {
  // Every lookup fails: the warning must say COULDN'T CHECK, never safe.
  await page.goto(base);
  await sw.evaluate(() => { self.__fetch = self.fetch; self.fetch = () => Promise.reject(new TypeError("Failed to fetch")); });
  await page.evaluate(() => navigator.clipboard.writeText("ghost-account-1234.testnet"));
  await pasteInto(page); await waitVerdict(page);
  await clip(page, "extension-warning-couldnt-check");
  await sw.evaluate(() => { self.fetch = self.__fetch; });
}
if (which === "all" || which === "popup") {
  const pp = await ctx.newPage();
  await pp.setViewportSize({ width: 380, height: 900 });
  await pp.goto(`chrome-extension://${id}/popup.html`);
  await pp.evaluate(() => chrome.storage.local.set({ contacts: [{ account: "northwind-payroll.testnet", label: "Northwind payroll" }, { account: "hammed-stampdue.testnet", label: "Me" }] }));
  await pp.reload();
  await pp.fill("#to", "northwind-payro11.testnet");
  await pp.fill("#amount", "40");
  await pp.click("#go");
  await pp.waitForSelector("#result .gw", { timeout: 20000 });
  await pp.waitForTimeout(1500);
  const h = await pp.evaluate(() => document.getElementById("app").scrollHeight);
  await pp.setViewportSize({ width: 380, height: h });
  await pp.screenshot({ path: `${OUT}/extension-popup.png`, fullPage: true });
  console.log("popup result", await pp.textContent("#result .gt"));
}
await ctx.close();
server.close();
