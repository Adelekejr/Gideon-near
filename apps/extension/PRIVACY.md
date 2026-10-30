# Gideon extension: what it reads, keeps and sends

This file describes the code in this folder (`src/`, `manifest.json`) as of version 0.2.6.
If the code and this file ever disagree, that's a bug: please report it.

## Short version

- Gideon **never reads your clipboard on its own**. It has no `clipboardRead` permission and
  never calls `navigator.clipboard`. It only sees text when **you** copy or paste on a web page,
  the same way the page itself does.
- Gideon **never asks for, reads or sends private keys, seed phrases or passwords**. It does not
  sign anything and holds no keys. Fields that look like they hold a secret are skipped entirely.
- The only thing that leaves your device is the **address you are about to send to** (and, for
  some checks, **your own account name**), sent to public NEAR and blockchain APIs listed below.
  There is no Gideon server, no analytics, no tracking, no account.
- Everything Gideon remembers stays in your browser's extension storage on this device.

## Permissions

| Manifest entry | Why |
| --- | --- |
| `permissions: ["storage"]` | Saves your settings, address book, "your accounts", stats, last check and the list of sends made on this device (see below). Nothing else. |
| `content_scripts` on `http://*/*` and `https://*/*` (top frame only) | Wallets and exchanges live on many different sites, so Gideon can't know in advance which page has a send form. The script stays passive until you paste or type into a text field. |
| `host_permissions` (14 hosts, listed below) | The public APIs the checks call. No other site can be contacted. |
| `web_accessible_resources: fonts/*.woff2` | The card's fonts. A side effect: a page could detect that Gideon is installed by trying to load one of these files. |

There is no `clipboardRead`, `tabs`, `history`, `cookies`, `webRequest` or `<all_urls>` host permission.

## What the page script looks at

The content script runs on web pages and reacts to three things:

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
   check on and whose history to read. This is read in place and not stored, except the account
   name: when the wallet shows your full account it is added to "Your accounts".

Gideon can't see copies made in other apps or tabs, or what an app outside the browser does to
your clipboard. It only knows what you copied on the same page.

## What is sent, and where

Requests go from the extension's background worker straight to these public APIs. No cookies or
API keys are attached, and the page's address is not included.

| Host | When | What it receives |
| --- | --- | --- |
| `rpc.mainnet.fastnear.com`, `free.rpc.fastnear.com`, `rpc.testnet.fastnear.com`, `test.rpc.fastnear.com` (and `archival-rpc.*.fastnear.com`) | Every check | The recipient account (does it exist, balance, contract). For tokens: the token contract and whether the recipient is registered with it. With an unclear network: the same name on the other network. |
| `tx.main.fastnear.com`, `tx.test.fastnear.com` | When your sending account is known | **Your account name**, to read your recent transactions (have you sent to this address before, does it look like someone you paid). |
| `tx.main.fastnear.com`, `tx.test.fastnear.com` and the NEAR RPC hosts above | Drained-wallet check (R18), when the recipient is a NEAR account that isn't yours, a contact or a known exchange | The **recipient account**, to list who recently sent it NEAR; then the **account names of up to 40 of those senders**, to read their transactions up to that send and their current balance. Nothing about you is sent. |
| `api.nearblocks.io`, `api-testnet.nearblocks.io` | Account age, first-send and pasted-hash checks | The recipient; **your account name together with the recipient** (count of past sends between them); a pasted NEAR transaction hash. |
| `1click.chaindefuser.com` | When the recipient looks like a NEAR Intents deposit address | That deposit address. |
| `api.trongrid.io`, `ethereum-rpc.publicnode.com`, `mempool.space` | When what was pasted into a recipient field looks like a transaction hash from another chain | That hash. |

These services see the request like any website would (including your IP address) and have their
own privacy policies. Gideon sends nothing else: no page content, no copied text, no amounts, no
identifiers, no usage data.

## What is stored on this device

All in `chrome.storage.local` (never synced, never uploaded):

| Key | Content |
| --- | --- |
| `settings` | Your toggles and network choice. |
| `shift` | The colour theme. |
| `contacts` | Your address book (accounts and labels you added). |
| `myAccounts` | "Your accounts" (added by you, or seen in full in a wallet header). |
| `sends` | Sends made on wallet pages after Gideon checked them: recipient, your account if known, network, time. Up to 100. |
| `last` | The last page check: site name, network, recipient, verdict, headline, time. |
| `stats` | Two counters: checks run, sends stopped. |

Removing the extension deletes all of it.

The drained-wallet check (R18) keeps its answers for up to 10 minutes in the background worker's
memory only (not in storage), so checking the same address again doesn't repeat the lookups. They
are gone when the browser stops the worker.
