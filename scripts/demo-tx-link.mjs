#!/usr/bin/env node
// Prints UNSIGNED testnet wallet links for demoing Gideon's transaction checks. Read-only:
// it never signs, never sends, never makes or keeps a private key.
//   node scripts/demo-tx-link.mjs [signer.testnet]
// The request asks for two risky things Gideon must catch before you press Approve:
//   1. AddKey with FULL ACCESS (a random public key nobody holds the private key for)
//   2. a Transfer of ~99% of the signer's live testnet balance to an account that doesn't exist
// Open a link, look at the warning, then press Reject / Cancel in the wallet. Testnet only.
import { randomBytes } from "node:crypto";
import { base58, encodeTransaction, toBase64, checkTransaction } from "@gideon/core";
import { liveSources } from "@gideon/sources";

const signer = (process.argv[2] ?? "hammed-stampdue.testnet").toLowerCase();
if (!signer.endsWith(".testnet")) { console.error("Testnet accounts only (…testnet)."); process.exit(64); }
const NOBODY = "gideon-demo-nobody-7f3a.testnet";
const key = `ed25519:${base58(randomBytes(32))}`;

const rpc = await fetch("https://rpc.testnet.near.org", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: signer } }),
}).then((r) => r.json());
const bal = BigInt(rpc.result?.amount ?? "0");
if (!bal) { console.error(`Couldn't read ${signer} on testnet.`); process.exit(1); }
const amount = (bal * 99n) / 100n;

const txs = [
  { signerId: signer, publicKey: key, receiverId: signer, actions: [{ type: "AddKey", publicKey: key, fullAccess: true }] },
  { signerId: signer, publicKey: key, receiverId: NOBODY, actions: [{ type: "Transfer", deposit: amount.toString() }] },
].map((t) => encodeURIComponent(toBase64(encodeTransaction(t)))).join(",");
const cb = encodeURIComponent("https://gideon-demo.example/done");

const mnw = `https://testnet.mynearwallet.com/sign?transactions=${txs}&callbackUrl=${cb}`;
const meteor = `https://wallet.meteorwallet.app/connect/testnet/sign?transactions=${txs}&callback_url=${cb}`;
console.log(`UNSIGNED TESTNET DEMO. Do not approve: press Reject / Cancel.\n`);
console.log(`Signer: ${signer} (balance ${(Number(bal / 10n ** 20n) / 1e4).toFixed(4)} NEAR, link sends 99%)`);
console.log(`Full-access key (nobody holds its private key): ${key}\n`);
console.log(`MyNearWallet:\n${mnw}\n\nMeteor:\n${meteor}\n`);

const r = await checkTransaction({ request: mnw }, liveSources());
console.log(`Gideon on this link: ${r.verdict}`);
for (const f of r.findings) console.log(`  ${f.status} ${f.rule} ${f.title}`);
