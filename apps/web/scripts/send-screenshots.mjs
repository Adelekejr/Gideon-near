// UI test + screenshots for send.html with a MOCK wallet and mocked chain answers.
// Nothing is signed or sent: the mock wallet records the transfer it was asked to sign.
// Needs a build (npm run build:web) and playwright-core with Chromium:
//   node apps/web/scripts/send-screenshots.mjs [outDir]
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const OUT = process.argv[2] ?? "/tmp/gideon-send-shots";
mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const server = createServer((req, res) => {
  const p = join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(dist) || !existsSync(p)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream" }).end(readFileSync(p));
}).listen(8766, "127.0.0.1");

// Mock chain: kemi-rent is a normal past recipient; three payroll accounts look alike and payrol1 sent the user dust (address poisoning).
const ME = "gideon-demo.testnet", RENT = "kemi-rent.testnet", REAL = "northwind-payroll.testnet", LOOK = "northwind-payro11.testnet", POISON = "northwind-payrol1.testnet";
const ACCOUNTS = new Set([ME, RENT, REAL, LOOK, POISON]);
const HISTORY = [
  { transaction_hash: "4xRentTx", signer_account_id: ME, receiver_account_id: RENT, actions_agg: { deposit: 3e24 }, block_timestamp: "0" },
  { transaction_hash: "9xRealPayrollTx", signer_account_id: ME, receiver_account_id: REAL, actions_agg: { deposit: 2e24 }, block_timestamp: "1" },
  { transaction_hash: "7xDustTx", signer_account_id: POISON, receiver_account_id: ME, actions_agg: { deposit: 1e18 }, block_timestamp: "2" },
];

const MOCK_WALLET = ({ me }) => {
  window.__signed = [];
  const accounts = [{ accountId: me, publicKey: "ed25519:11111111111111111111111111111111" }];
  const icon = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#111210"/><rect x="26" y="6" width="6" height="28" fill="#FF4D1A"/></svg>');
  window.addEventListener("near-selector-ready", () => window.dispatchEvent(new CustomEvent("near-wallet-injected", { detail: {
    manifest: { id: "gideon-mock", name: "Mock wallet (test only)", icon, website: "https://example.invalid", description: "Records requests, signs nothing", version: "1.0.0", type: "injected", permissions: {},
      features: { signMessage: false, signTransaction: false, signAndSendTransaction: true, signAndSendTransactions: false, signInWithoutAddKey: true, signInAndSignMessage: false, signInWithFunctionCallKey: false, signDelegateActions: false, mainnet: false, testnet: true } },
    signIn: async () => accounts,
    signOut: async () => {},
    getAccounts: async () => accounts,
    signAndSendTransaction: async (p) => { window.__signed.push(JSON.parse(JSON.stringify(p))); return { transaction: { hash: "MOCKtx1111111111111111111111111111111111111" }, status: { SuccessValue: "" } }; },
  } })));
};

const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
await page.addInitScript(MOCK_WALLET, { me: ME });
await page.route((u) => /fastnear\.com$/.test(u.hostname), async (route) => {
  const body = JSON.parse(route.request().postData() ?? "{}");
  if (body.method === "block") return route.continue(); // the live watch log reads the block height
  const p = body.params ?? {};
  if (p.request_type === "view_account") {
    return route.fulfill({ json: ACCOUNTS.has(p.account_id)
      ? { jsonrpc: "2.0", id: "gideon", result: { amount: "5000000000000000000000000", code_hash: "11111111111111111111111111111111", storage_usage: 182 } }
      : { jsonrpc: "2.0", id: "gideon", error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCOUNT" } } } });
  }
  return route.fulfill({ status: 500, body: "not mocked" });
});
await page.route((u) => u.hostname === "api-testnet.nearblocks.io", (route) =>
  route.fulfill({ json: { txns: route.request().url().includes(`/account/${ME}/`) ? HISTORY : [] } }));

const sendBtn = () => page.locator("#send");
const shot = async (name) => { await page.waitForTimeout(1300); /* let the Arrow G finish */ await page.screenshot({ path: join(OUT, name), fullPage: true }); console.log("saved", name); };
async function checkFor(to, amount = "2.5") {
  await page.fill("#to", to);
  await page.fill("#amount", amount);
  assert.equal(await sendBtn().isDisabled(), true, "editing must lock Send until a new check");
  await page.click("#checkbtn");
  await page.waitForFunction(() => !document.querySelector("#checkbtn")?.textContent?.startsWith("Checking"));
}

await page.goto("http://127.0.0.1:8766/send.html");
assert.equal(await sendBtn().isDisabled(), true);
await page.click("#conn");
await page.waitForSelector('.connect-item[data-type="gideon-mock"]', { timeout: 20000 });
await page.waitForTimeout(1200);
await shot("send-1-connect.png");
await page.click('.connect-item[data-type="gideon-mock"]');
await page.waitForSelector("#disc");

await checkFor(RENT);
assert.match(await page.locator("#gate .chip").innerText(), /NO PROBLEMS FOUND/);
assert.equal(await sendBtn().isDisabled(), false);
await shot("send-2-safe.png");

await checkFor(LOOK);
assert.match(await page.locator("#gate .chip").innerText(), /LOOK AGAIN/);
assert.equal(await sendBtn().isDisabled(), true, "ATTENTION needs a confirm");
await shot("send-3-attention.png");
await page.check("#ok");
assert.equal(await sendBtn().isDisabled(), false);

await checkFor(POISON);
assert.match(await page.locator("#gate .chip").innerText(), /BLOCKED/);
assert.equal(await page.locator("#ok").count(), 0, "no override on BLOCKED");
assert.equal(await sendBtn().isDisabled(), true);
await shot("send-4-blocked.png");

assert.deepEqual(await page.evaluate(() => window.__signed), [], "nothing signed before a SAFE send is clicked");
await checkFor(RENT);
await sendBtn().click();
await page.waitForFunction(() => document.querySelector("#gate .chip")?.textContent === "SENT");
const signed = await page.evaluate(() => window.__signed);
assert.equal(signed.length, 1);
assert.equal(signed[0].receiverId, RENT);
assert.equal(signed[0].signerId, ME);
assert.equal(JSON.stringify(signed[0].actions), JSON.stringify([{ type: "Transfer", params: { deposit: "2500000000000000000000000" } }]));
assert.equal(await sendBtn().isDisabled(), true, "no double send");
await shot("send-5-sent.png");

console.log("send flow OK: SAFE sends, ATTENTION needs confirm, BLOCKED can't send; mock wallet signed 1 transfer:", JSON.stringify(signed[0]));
await browser.close();
server.close();
