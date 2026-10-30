import type { PageAccounts } from "./sender.js";

/**
 * Who's signed in, from what the page itself records, for any NEAR web wallet or dApp.
 * Read on this device only, and only account names: never keys, never anything else in storage.
 *
 * Per-wallet rules are added only where the wallet's own code could be checked:
 * - MyNearWallet (app.mynearwallet.com, testnet.mynearwallet.com): open source. Keeps the signed-in
 *   account in localStorage "_4:wallet:active_account_id_v2" and shows it in
 *   [data-test-id="currentUser"] (packages/frontend/src/utils/wallet.ts, components/navigation/UserAccount.js).
 * Everything else (Meteor, HOT/HERE, Bitte, and Sender or Nightly where a site is signed in with them)
 * uses the generic reading: the one account name in the header or account menu (full or shortened),
 * a near-api-js sign-in kept by the site, ?account_id= / ?signer_id= in the address, and the title.
 * Different names from those sources mean no sender: Gideon never guesses.
 */
interface WalletRule {
  name: string;
  host: RegExp;
  storageKeys: string[];
  selectors: string[];
}

export const WALLETS: WalletRule[] = [
  {
    name: "MyNearWallet",
    host: /(^|\.)mynearwallet\.com$/,
    storageKeys: ["_4:wallet:active_account_id_v2"],
    selectors: ['[data-test-id="currentUser"]'],
  },
];

/** Query names wallets use when they send you back after sign-in. Never recipient-style names. */
const URL_KEYS = ["account_id", "signer_id", "signerId"];
const NAME = /[a-z\d][a-z\d._-]{0,62}\.(?:testnet|near)\b|\b[0-9a-f]{64}\b/gi;

type Store = Pick<Storage, "getItem" | "key" | "length">;

export function pageAccounts(doc: Document, href: string, store: Store | null): PageAccounts {
  const out: PageAccounts = {};
  let host = "";
  try {
    const u = new URL(href);
    host = u.hostname;
    const qs = [u.searchParams, new URLSearchParams(u.hash.replace(/^#[^?]*\??/, ""))];
    const url = qs.flatMap((q) => URL_KEYS.map((k) => q.get(k) ?? "")).filter(Boolean);
    if (url.length) out.url = url;
  } catch {
    /* not a URL */
  }
  const wallet = WALLETS.find((w) => w.host.test(host));
  if (wallet) {
    const accounts: string[] = [];
    for (const k of wallet.storageKeys) {
      const v = safe(() => store?.getItem(k) ?? null);
      if (v) accounts.push(v);
    }
    for (const sel of wallet.selectors) doc.querySelectorAll(sel).forEach((el) => { const t = el.textContent?.trim(); if (t) accounts.push(t); });
    if (accounts.length) out.wallet = { name: wallet.name, accounts };
  }
  // near-api-js keeps "<app>_wallet_auth_key" = {"accountId": …, "allKeys": [public keys]} on sites you signed in to.
  const dapp: string[] = [];
  const n = safe(() => store?.length ?? 0) ?? 0;
  for (let i = 0; i < Math.min(n, 200); i++) {
    const k = safe(() => store!.key(i));
    if (!k || !k.endsWith("_wallet_auth_key")) continue;
    const id = safe(() => JSON.parse(store!.getItem(k) ?? "null")?.accountId);
    if (typeof id === "string") dapp.push(id);
  }
  if (dapp.length) out.dapp = dapp;
  const title = (doc.title || "").match(NAME);
  if (title?.length) out.title = title;
  return out;
}

function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch {
    return null;
  }
}
