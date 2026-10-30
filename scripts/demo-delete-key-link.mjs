// Builds (never signs) a wallet link that deletes one access key, for testing "Remove key in my wallet".
//   npm run build -w @gideon/core -w @gideon/sources
//   node scripts/demo-delete-key-link.mjs [account.testnet] [ed25519:key-to-remove]
//   node scripts/demo-delete-key-link.mjs [account.testnet] --sample   (format check with a made-up key)
// It refuses to build a deletion of an account's only full control key: that would lock the account.
// Without a key argument it picks an app key (a "throwaway" key a dApp added). If there is none,
// it prints how to add one. Opening the link only shows the wallet's own approval screen; nothing
// happens unless you approve it there.
import { accountHealth, base58, deleteKeyLinks, parseTxRequest } from "@gideon/core";
import { randomBytes } from "node:crypto";
import { liveSources } from "@gideon/sources";

const account = process.argv[2] ?? "hammed-stampdue.testnet";
const sample = process.argv.includes("--sample");
const wanted = sample ? undefined : process.argv[3];
const r = await accountHealth({ account }, liveSources({ timeoutMs: 8000 }));
console.log(`${account} · ${r.network} · ${r.status}: ${r.summary}`);
for (const k of r.keys) console.log(`  ${k.kind === "full" ? "full" : `app (${k.contract})`}  ${k.publicKey}${k.probableWalletKey ? "  ← probable wallet key" : ""}`);

const full = r.keys.filter((k) => k.kind === "full");
const wallet = r.keys.find((k) => k.probableWalletKey)?.publicKey;
const target = wanted ? r.keys.find((k) => k.publicKey === wanted) : r.keys.find((k) => k.kind === "app" && k.removable);
if (wanted && !target) { console.log(`\n${wanted} isn't a key of ${account}.`); process.exit(1); }
if (target?.kind === "full" && full.length === 1) {
  console.log("\nRefusing: that is the only full control key. Removing it would lock you out of the account.");
  process.exit(1);
}
if (!target && sample) {
  // A random public key that is not on the account: shows the link and what the wallet will be asked, nothing more.
  const fake = `ed25519:${base58(new Uint8Array(randomBytes(32)))}`;
  const l = deleteKeyLinks(r.network, account, fake, wallet ? { walletKey: wallet } : {});
  const tx = parseTxRequest(l.meteor).transactions[0];
  console.log(`\nFORMAT CHECK ONLY. ${fake} is a made-up key that is not on ${account}. Don't approve this one: it would only fail.`);
  console.log(`Decoded: signer ${tx.signerId} → ${tx.receiverId}, actions ${JSON.stringify(tx.actions)}\nMeteor: ${l.meteor}`);
  process.exit(0);
}
if (!target) {
  console.log(`
No throwaway key to remove yet. ${account} has ${full.length === 1 ? "only one full control key, which must stay" : "no app keys"}.
Add one first (testnet, no real money):
  1. Open any testnet dApp that asks you to "Connect wallet" or "Sign in", for example a testnet NEAR app
     in Meteor's testnet mode, and sign in with ${account}.
  2. Approve the sign-in. The wallet adds a small app key (function-call key) for that dApp's contract.
  3. Run this script again: it will pick that app key and build the delete link for it.`);
  process.exit(0);
}
const l = deleteKeyLinks(r.network, account, target.publicKey, wallet && wallet !== target.publicKey ? { walletKey: wallet } : {});
const tx = parseTxRequest(l.meteor).transactions[0];
console.log(`\nKey to remove: ${target.publicKey}\nDecoded: signer ${tx.signerId} → ${tx.receiverId}, actions ${JSON.stringify(tx.actions)}`);
console.log(`\n${l.confirm}\nMeteor: ${l.meteor}${l.mynearwallet ? `\nMyNearWallet: ${l.mynearwallet}` : ""}`);
console.log("\nNot signed. Open the link on your phone or desktop and approve only if the key matches.");
