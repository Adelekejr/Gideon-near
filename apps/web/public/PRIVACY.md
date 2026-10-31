# Gideon extension: what it reads, keeps and sends

This file describes the code in this folder (`src/`, `manifest.json`) as of version 0.3.1.
If the code and this file ever disagree, that's a bug: please report it.

## Short version

- Gideon **never reads your clipboard on its own**. It has no `clipboardRead` permission and
  never calls `navigator.clipboard`. It only sees text when **you** copy or paste on a web page,
  the same way the page itself does.
- Gideon **never asks for, reads or sends private keys, seed phrases or passwords**. It does not
  sign anything and holds no keys. Fields that look like they hold a secret are skipped entirely.
- The only thing that leaves your device is the **address you are about to send to** (and, for
  some checks, **your own account name**), sent to public NEAR and blockchain APIs listed below.
  On a wallet's approval screen, that is the **account names in the request** (yours, the contract
  or person it goes to, the token or NFT contract), never the request itself.
  There is no Gideon server, no analytics, no tracking, no account.
- Everything Gideon remembers stays in your browser's extension storage on this device.

## Permissions

| Manifest entry | Why |
| --- | --- |
| `permissions: ["storage"]` | Saves your settings, address book, "your accounts", stats, last check and the list of sends made on this device (see below). Nothing else. |
| `content_scripts` on `http://*/*` and `https://*/*` (top frame only) | Wallets and exchanges live on many different sites, so Gideon can't know in advance which page has a send form. The script reacts when you paste or type into a text field, and watches the page's address and headings for a wallet approval screen (see below). |
| `host_permissions` (14 hosts, listed below) | The public APIs the checks call. No other site can be contacted. |
| `web_accessible_resources: fonts/*.woff2` | The card's fonts. A side effect: a page could detect that Gideon is installed by trying to load one of these files. |

There is no `clipboardRead`, `tabs`, `history`, `cookies`, `webRequest` or `<all_urls>` host permission.

## What the page script looks at

The content script runs on web pages and reacts to four things:

1. **Paste and typing into a text field** (not `type=password`).
   It checks the value only when it is a single word under 120 characters **and** either looks
   like an address (a `.near`/`.testnet` name, `0x` + 40 hex, a Tron or Bitcoin address) or
   sits in a field labelled as a recipient ("Send to", "Recipient", "Withdrawal address" …).
   - Values of **64 hex characters, with or without `0x`**, are also how an Ethereum private key
     looks, so these are only checked in a field labelled as a recipient.
   - Fields labelled as a **private key, secret, seed, mnemonic, recovery phrase, passphrase,
     "word 3", import wallet/key**, or marked `autocomplete="current-password"` / `new-password` /
     `one-time-code` are **never** checked, whatever is typed in them.
   - Anything with a space (such as a recovery phrase) is never checked.
2. **Copy and cut on the page** (for the "what you copied isn't what you pasted" check, R9).
   - The selected text is looked at during the copy event only, to spot a page script that swaps
     it for a different address. It is dropped as soon as the event ends.
   - It is **remembered only if it looks like an address** (a dotted NEAR name such as alice.near
     or bob.tg, a 64-hex or 0x account, or another chain's address), in the page script's memory (not in
     storage), for at most **2 minutes**, and forgotten as soon as you switch tab or window.
     Any other copied text (a phrase, a password, a message) is not kept at all.
   - When you then paste into a field Gideon checks, the remembered address is compared with what
     was pasted. The comparison happens on your device; the copied address is not sent anywhere.
   - Turning off "Compare what I copied with what I paste (R9)" in the popup stops all of this.
3. **Short text on the page that names the network and your account** (for example a
   "Testnet" badge, the URL, or the account name in a wallet header), to decide which network to
   check on and whose history to read. This is read in place and not stored. Since 0.3.1 an
   account seen on a page is **never added to "Your accounts" on its own**: the card asks
   "Is {account} yours? [Add to Your accounts]", and only your click adds it. Until then it is
   treated as a guess, never as your own account.
   - **Sign-in records the site keeps in this browser (`localStorage`).** On the page you are on,
     Gideon reads the account name a NEAR sign-in left there (MyNearWallet's
     `_4:wallet:active_account_id_v2`, and the `*_wallet_auth_key` record near-api-js sites keep),
     only to work out your account name. It reads account names only, never keys or anything else
     stored there, and keeps nothing.

4. **A wallet's request to approve or sign a NEAR transaction** (new in 0.2.8). Gideon looks for it
   in two places, and only reads; it never clicks, fills or changes anything on the wallet page,
   and does not hold the Approve button:
   - **The page address.** Wallet sign links carry the unsigned request in the URL:
     MyNearWallet `…mynearwallet.com/sign?transactions=…`, Meteor's redirect flow
     `wallet.meteorwallet.app/connect/<network>/sign?transactions=…`, and, on any other site, a
     `transactions=` value only when it decodes as real NEAR transactions. A MyNearWallet sign-in
     link (`/login?public_key=…` without a contract) is read as a full-access sign-in.
   - **The approval screen itself**, when the address doesn't carry the request (Meteor's pop-up
     flow). Only when the page shows a heading such as "Approve Transaction(s)". On
     `wallet.meteorwallet.app` it reads the From / To explorer links and the wallet's own
     full-access wording; on any other site it reacts only to that full-access wording. Text in
     scripts and styles is ignored. This screen reading follows Meteor's public app code and has
     not been checked against the live Meteor wallet (the sign-link reading has). A request read
     only from the screen is never shown as "no problems found". Only Meteor's **web** wallet is
     read; the Meteor browser extension's own pop-up (and other wallet extensions') is not.
   The request is decoded and checked on your device; the card says "Gideon only read this request
   from the page. It never touches your keys." Nothing from it is stored, and the check is not
   counted in your stats.

5. **The account you type into "Check my account"** in the popup (new in 0.2.9). Only that name.
   It is not stored (the field is filled from "Your accounts", which you already keep). The answer
   is shown in the popup and not kept. "Remove key in my wallet" builds an unsigned request in the
   popup and opens your wallet's own page with it; Gideon never signs or sends it. Since 0.3.0
   the link also tells the wallet where to go afterwards (`callback_url`: the account's page on
   NearBlocks), and, only in builds made with `GIDEON_SITE`, a "Remove with any wallet" link opens
   Gideon's website account page with **the account name, network and the public key** in its
   address, so the site can show that removal. The extension itself sends nothing new and has no
   new permissions or hosts. Opening either link is like opening any web page: that site sees it.

Gideon can't see copies made in other apps or tabs, or what an app outside the browser does to
your clipboard. It only knows what you copied on the same page.

## What is sent, and where

Requests go from the extension's background worker straight to these public APIs. No cookies or
API keys are attached, and the page's address is not included.

| Host | When | What it receives |
| --- | --- | --- |
| `rpc.mainnet.fastnear.com`, `free.rpc.fastnear.com`, `rpc.testnet.fastnear.com`, `test.rpc.fastnear.com` (and `archival-rpc.*.fastnear.com`) | Every check | The recipient account (does it exist, balance, contract). For tokens: the token contract and whether the recipient is registered with it. With an unclear network: the same name on the other network. When the indexer has no creation date: whether the recipient existed at the chain's first block (archival). |
| `tx.main.fastnear.com`, `tx.test.fastnear.com` | When your sending account is known | **Your account name**, to read your recent transactions (have you sent to this address before, does it look like someone you paid). |
| `tx.main.fastnear.com`, `tx.test.fastnear.com` and the NEAR RPC hosts above | Drained-wallet check (R18), when the recipient is a NEAR account that isn't yours, a contact or a known exchange | The **recipient account**, to list who recently sent it NEAR (its last 40 incoming transactions); then the **account names of up to 5 of those senders at a time**, to read their current balance and, only for senders left nearly empty, their transactions up to that send. Nothing about you is sent. |
| `api.nearblocks.io`, `api-testnet.nearblocks.io` | Account age, first-send and pasted-hash checks | The recipient; **your account name together with the recipient** (count of past sends between them); a pasted NEAR transaction hash. |
| NEAR RPC hosts, `tx.main.fastnear.com`, `tx.test.fastnear.com`, `api.nearblocks.io`, `api-testnet.nearblocks.io` | Transaction approval check | The **account names in the request**: the contract it calls (does it exist, when was it created, how many transactions, the drained-wallet check above); for a send, the recipient and **your account name** (your balance of that token, have you sent to them before); for an NFT approval, the NFT contract and token id. Not the request, not the page address. |
| `api.nearblocks.io`, `api-testnet.nearblocks.io`, NEAR RPC hosts (with `archival-rpc.*`), `tx.main.fastnear.com`, `tx.test.fastnear.com` | "Check my account" | **The account you typed**: its access keys (public keys only), when they were added, its recent transactions signed by it, and the time of a few blocks. For app keys, the contract each key may call (age, history, the drained-wallet check above). |
| `1click.chaindefuser.com` | When the recipient looks like a NEAR Intents deposit address | That deposit address. |
| `api.trongrid.io`, `ethereum-rpc.publicnode.com`, `mempool.space` | When what was pasted into a recipient field looks like a transaction hash from another chain | That hash. |

These services see the request like any website would (including your IP address) and have their
own privacy policies. Gideon sends nothing else: no other page content, no copied text, no amounts, no
identifiers, no usage data.

## What is stored on this device

All in `chrome.storage.local` (never synced, never uploaded):

| Key | Content |
| --- | --- |
| `settings` | Your toggles and network choice. |
| `shift` | The colour theme. |
| `contacts` | Your address book (accounts and labels you added). |
| `myAccounts` | "Your accounts" (only ones you added: in the popup, or with "Add to Your accounts" on a card). |
| `sends` | Sends made on wallet pages after Gideon checked them (only after a real click on the page's Send button, and never for a STOPPED check): recipient, your account if known, network, time. Up to 100. |
| `last` | The last page check: site name, network, recipient, verdict, headline, time. |
| `stats` | Two counters: checks run, sends stopped. |

Removing the extension deletes all of it.

The drained-wallet check (R18) keeps its answers for up to 10 minutes in the background worker's
memory only (not in storage), so checking the same address again doesn't repeat the lookups. They
are gone when the browser stops the worker.
