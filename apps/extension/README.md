# apps/extension

The Gideon browser extension for Chrome (Manifest V3). It bundles the same
engine as the CLI and website (`@gideon/core` and `@gideon/sources`).

## Install (Load unpacked)

```bash
npm install
npm run build:extension      # → apps/extension/dist
npm run zip:extension        # → apps/extension/gideon-extension-0.3.1.zip
```

Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**
and choose `apps/extension/dist` (or an unzipped copy of the zip).

## How it's put together

| File | Job |
| --- | --- |
| `src/background.ts` | Service worker. Runs `check()` with the free live sources, adds your network and address book, keeps the stats and the last page check. |
| `src/content.ts` | Watches paste and typing in recipient-looking fields, asks the worker to check, shows the warning in a closed shadow root under the field, and holds the page's Send button on STOPPED. Also the in-page clipboard check (R9). |
| `src/popup.ts`, `popup.html` | The popup: Light / Dark / Auto (Auto follows the device setting), manual check, last page check, guards, network switch, address book. Footer shows the NEAR logo. NEAR and the NEAR logo are trademarks of NEAR Foundation. Gideon shows the logo unaltered, only to say it is built on NEAR. Gideon is an independent project, not made or endorsed by NEAR Foundation. |
| `src/lib/approval.ts` | Finds a wallet's request to approve a NEAR transaction: in the page address (MyNearWallet and Meteor sign links, any decodable `transactions=`), or on Meteor's approval screen (heading, From / To links, full-access wording). Read only. |
| `src/lib/detect.ts` | Which fields are recipients, which values are worth checking, which buttons to hold. |
| `src/lib/clipboard.ts` | What you copied on this page (forgotten after 2 minutes, on blur or tab switch), and whether a page swapped it. |
| `src/lib/view.ts`, `style.ts` | The verdict card and its styles, in the same fonts and light/dark colours as the website. Red only for STOPPED, amber for look again or couldn't check, green for no problems found. |
| `src/lib/motion.ts` | Plays the Gate G on each real result: slams shut on STOPPED, lifts and blinks on look again, empties to an outline when it couldn't check, rises on no problems found. Under 1.2 s; final pose only with reduced motion. |
| `src/lib/shift.ts` | The theme choice (light, dark or system), saved in `chrome.storage.local` under `theme`. |
| `build.mjs` | Vite IIFE builds for each entry, copies `static/`, `popup.html` and `manifest.json`, and writes the zip. |
| `src/lib/network.ts`, `resolve.ts` | Auto network: reads the page address and short account-name / "Testnet" badge texts on this device, then decides which network to check on (see below). |
| `src/lib/place.ts` | Where the card goes: under the field, or above it when a phone keyboard leaves no room; never wider than the screen. |
| `test-page/meteor-send.html` | A local reconstruction of Meteor Wallet's send screen (its public strings, not its markup) for testing Auto network. `?account=you.near`, `?menu=1`. |
| `test-page/meteor-approve.html` | A local reconstruction of Meteor Wallet's "Approve Transaction(s)" screen (its public strings, not its markup). `?full=1` asks for a full-access key, `?signer=`, `?to=`. Opened from a file or localhost only the full-access reading applies; the From / To links are read on Meteor's own address only. |
| `test-page/withdraw.html` | A local, fake withdrawal page for trying it. `?hijack=1` simulates a page that swaps copied addresses. |
| `scripts/screenshots.mjs` | Loads `dist/` into Playwright's Chromium and takes the screenshots in `/shots`. Needs `playwright-core` and `npx playwright install chromium`. |

Tests are in `test/` and run with the root `npm test`.

What the extension reads, keeps and sends: [PRIVACY.md](PRIVACY.md).

## What changed in 0.3.1

Fixes from the pre-release audit. Every fix also applies to the website, the CLI and the MCP server.

- **Never green without a real check.** If the lookups fail, or the request was only read off the
  wallet's screen (Meteor), the card says COULDN'T CHECK and Gideon tries again. Green needs a
  live answer.
- **More action types.** DeployContract is STOPPED, and so is DeleteAccount unless the
  money goes to one of your accounts or a contact (then LOOK AGAIN). A call with a deposit of
  100 NEAR or more gets a second look, even to a well-known contract. Stake is LOOK AGAIN. An
  action Gideon can't read is COULDN'T CHECK.
- **Every account in a request is checked**: each recipient, the contract called, the token
  receiver and a DeleteAccount beneficiary (lookalikes, fake letters, reported scams, missing
  accounts).
- **No account planting.** A sender read from the page is never saved to Your accounts.
  Gideon asks "Is {account} yours?" and adds it only when you click. Clicks and pastes made by a
  page script are ignored.
- **Whole balance.** Everything leaving in one request is added up. The threshold is now 90%,
  so 94%, or 49% + 49% to two strangers, is flagged.
- **Wording.** Green reads "NO PROBLEMS FOUND". Anything Gideon couldn't check is listed on a
  "Not checked" line.
- **Failures are visible.** A failed check of recent senders says so, and errors are in plain
  words.
- PRIVACY.md, LICENSE.txt and THIRD_PARTY_NOTICES.txt now ship in the zip.
- No new permissions or hosts.

## What changed in 0.3.0

- **Removal links that Meteor can read.** Meteor's sign page needs a `callback_url`; 0.2.9's
  "Open in Meteor" links had none, so Meteor showed "Couldn't parse the correct arguments for
  signing the transaction". Every link now carries one (the account on NearBlocks).
- **A DeleteKey request is never "no problems found".** The transaction card names it: "Removes a
  key from your account", and it is red when it removes a full control key (STOPPED for the
  last one). A sign link Gideon can't decode, or a wallet screen that says it couldn't read the
  request, shows "Gideon couldn't read this request" / "Your wallet couldn't read this request"
  instead of a verdict.
- **"You can tidy these up".** App keys that can call any method, have no gas-fee limit, or
  went unused for 6 months are listed quietly under this heading. They aren't flagged and
  don't change a CLEAN result. Red is for danger only: a risky contract's app key is now amber.
- **One quiet retry** before "Couldn't read this account's history" or the key list fails.
- **"Remove with any wallet"** opens the website's account page for that key, where any NEAR
  wallet can sign the removal. Shown only when built with `GIDEON_SITE` (see the main README).
- No new permissions or hosts.

## What changed in 0.2.9

- **Check my account.** A new popup section, read-only: type your account (it starts with the
  first of "Your accounts") and Gideon lists who can act for it from public key data, with the
  same card as a send check: DANGER when a full control key looks like someone else's
  (added recently by another key, or it removed the other keys or sent the funds out soon after
  it was added), LOOK AGAIN for app keys with no limits or unused for months, CLEAN otherwise.
  "Remove key in my wallet" shows the confirmation, then links that open Meteor (and
  MyNearWallet on mainnet) with an unsigned DeleteKey; the wallet signs, never Gideon. The
  probable wallet key's links stay off until you tick its warning, and the only full control key
  is never offered. No new permissions or hosts.

## What changed in 0.2.8

- **Check a transaction before you approve it.** When a wallet shows a NEAR approval request,
  Gideon shows its card at the top of the page before you tap Approve, with four warnings:
  a request for a full-access key (STOPPED), a call to a contract created under 30 days ago
  with little history or linked to drained wallets, a send of your whole token balance to an
  account you haven't sent to, and an approval that lets someone move your NFT. It reads the
  request from MyNearWallet and Meteor sign links in the page address, and from Meteor's
  approval screen when the address doesn't carry it. Verified in Playwright's Chromium on the
  MyNearWallet testnet sign link from `scripts/demo-tx-link.mjs` and on
  `test-page/meteor-approve.html`, and on a phone with the live Meteor testnet sign link
  (`/connect/testnet/sign?transactions=…`, not signed). Meteor's pop-up flow (the approval
  screen read from its public app code) is **not yet verified live**. Meteor already blocks
  full-access key requests on its own (only approved account recovery services may ask, and
  Approve is greyed out), so on Meteor the full-access card is a second opinion, not new. The card does not hold the Approve button, and
  shows nothing when the check itself fails. No new permissions.

- **Creation date in the popup's own check.** "Check this send" in the popup now fills in a
  creation date that missed the time limit, the same way the card on a page does (one quiet
  follow-up a moment later). On a slow phone connection `illia.near` showed "Creation date
  unavailable" there; it now shows "Created 21 Jul 2020".
- **Launch-day accounts on slow connections.** The indexer's "known account, no creation date"
  answer is remembered, and a launch-day read that ran out of time is recorded as missed (not
  skipped), so the follow-up fills the date in everywhere. The follow-up no longer counts as a
  second check.

## What changed in 0.2.7

- **Drained wallets (R18) catch more drainers.** A sender also counts as hacked when the new key
  first removed the owner's other keys and then sent here, or when a key the account hadn't used
  before removed the owner's keys and swept it. Collectors such as `dolbabob.near` are now BLOCKED.
  Senders that still hold NEAR are no longer read in depth, so the check asks for less.
- **No explorer links to accounts that don't exist.** For a missing account (`iliar.near`), an
  unused 64-character or 0x account, a contract that isn't a token, or a 1Click deposit address,
  the card shows the name as plain text. NearBlocks shows a page for any name, which made a missing
  account look real. Existing accounts are still linked.
- **Creation date for NEAR's oldest accounts.** Accounts from NEAR's launch (such as `illia.near`)
  showed "Creation date unavailable", because the indexer has no creation transaction for them.
  One quick archival read now dates them to 21 Jul 2020.

## What changed in 0.2.6

- **Fake address names (R17).** A NEAR name made to look like another chain's address
  (`0x5290…eed.near`, `TXYZ….tg`, `bc1q….near`) is blocked: "This is a NEAR name made to look like
  an Ethereum (EVM) address". A name that only partly looks like one gets a "Look again". Ordinary
  names such as `0xbob.near` pass.
- **Drained wallets (R18).** After the verdict shows, Gideon looks at the accounts that recently
  sent NEAR to the address. If two or more look hacked (a new full-access key added minutes
  before, used first to send here, account left nearly empty), the card changes to BLOCKED
  "Funds from hacked wallets were swept into this address"; one gives a "Look again". The card
  shows "senders → checking recent senders for hacked wallets…" while this runs (at most 8 s).
  Skipped for your own accounts, contacts and exchanges. If it fails, nothing changes.
- **Long addresses wrap** inside the card instead of running past its edge.

## What changed in 0.2.5

- **After an update, reload open pages.** A page left open while Gideon is updated or reloaded keeps
  the old copy, which the browser cuts off ("Extension context invalidated"). That copy now notices,
  stops asking, and shows "Gideon was updated. Reload this page to keep checking." Pages opened
  after the update are not affected.
- When the browser has stopped Gideon's background worker (Android does this often), a check that
  gets no answer asks once more, which wakes the worker.
- "Couldn't check" now reads "That doesn't mean the address is safe. Check it another way before you send."
- Your accounts and the address book accept `.near`, `.testnet` and 64-character hex accounts; the
  examples say so.
- **Wider hex lookalikes (R7).** 64-hex and `0x` accounts are compared with your contacts, the
  accounts you sent to from this device, and your on-chain history in more ways: the same first and
  last characters in any split (2+3, 4+4, 6+0 and so on, 5 or more in total), up to 4 characters
  changed, or one or two characters added or missing. `0x` accounts are compared after the `0x`.
- **Same name on the other network (R16).** Typing `alice.near` while sending on testnet, or
  `alice.testnet` on mainnet, when the same name exists on the network you're on: if Gideon is sure
  of your network it blocks with "Wrong network: did you mean alice.testnet?"; if it only looks like
  you're on the other network, it's a hint ("Your wallet may be on testnet"), never a block.

## What changed in 0.2.4

- **Long account names.** Meteor shortens long names in its header (`alice-wallet.testnet`
  shows as `alice-wal...testnet`), so 0.2.3 found no sender and skipped "first send" and the
  past-recipient lookalike check. Gideon now matches the short form to a full name elsewhere on
  the page or to "Your accounts" in the popup (new section; it also remembers every full name it
  reads from a wallet header). The card shows the sender it used: `sender → you.testnet · how`.
- **Fresh history.** Recent sends are read from FastNEAR's transactions API as well as NearBlocks
  (NearBlocks testnet was about a month behind), whichever answers, merged.
- **Sends from this device.** When you press the wallet's Send button on an address Gideon didn't
  stop, it remembers it (on this device only, last 100). Those count as "sent before", and an
  address that looks like one of them is STOPPED even before any explorer has indexed the send.
- A lookalike of someone you've sent to now leads over "doesn't exist".
- **Reported scam (R14).** Accounts publicly reported as scams are STOPPED, with a link to the report.
- **Fake letters (R15).** Letters from other alphabets, invisible characters and hidden spaces are
  STOPPED, naming the character, e.g. "contains a Greek 'α' that looks like 'a'".
- **NEAR web wallets.** (Web pages only: wallet browser extensions' own pop-ups, such as the
  Meteor extension's, are not read.) The sender is read the same way on every wallet and dApp: the wallet's
  own record where its code could be checked, else the one account name shown in the header or
  account menu (full, shortened, or 64-hex), a site's NEAR sign-in (`*_wallet_auth_key`),
  `?account_id=` / `?signer_id=` in the address, and the page title. If these name different
  accounts, Gideon doesn't guess (unless exactly one of them is under "Your accounts").
  Accounts in the address path are never used: on MyNearWallet `/send-money/<id>` is the recipient.

  | Wallet | How the sender is found | Checked |
  |---|---|---|
  | Meteor | header (shortened name) + "Your accounts" | live, Android Mises |
  | MyNearWallet | its stored active account and `[data-test-id="currentUser"]` | from its open source |
  | HOT (HERE), Bitte | header / account menu, title, address | generic only |
  | Sender, Nightly | browser extensions and mobile apps, no web wallet page; dApps signed in with them use the site's NEAR sign-in | generic only |

## What changed in 0.2.3

- The extension reads the account you're signed in with from the wallet's header (Meteor and
  others) and uses it as the sender. Nothing is sent anywhere except the public NearBlocks lookups.
- **First send.** If that account has never sent to the address you pasted, the card says
  "You've never sent to this address before" (look again). Saved contacts and past recipients pass.
  This lookup has its own 2.5 s limit and never holds up or changes the verdict when it's slow.
- **Lookalikes.** An address that looks almost like a saved contact or an account you've sent to
  (l/1, o/0, i/l, rn/m, - vs ., one extra or missing character, extra digits at the end, or a long
  hex address with the same first and last characters) is STOPPED, naming the address it imitates.
- Your recent history is remembered for 1 minute; "sent before" for 3 minutes.

## What changed in 0.2.2

- The in-page card can no longer sit on "Checking" for long. Every check now has hard time limits:
  6 s for the whole check (network guess included), 3 s for any one lookup (2 s per endpoint, so
  the backup RPC still gets a turn), and 1.5 s for info-only lookups (creation date, archival
  dating). Anything that misses its limit reads "Couldn't check in time", never "safe".
- The creation date never holds up the verdict. If it's slow, the card shows the verdict with
  "Creation date unavailable" and quietly fills the date in a moment later.
- The page stops waiting for the extension after 8 s (or at once if the worker was stopped)
  and says so, instead of spinning.
- Account lookups and finished checks are remembered for 3 minutes per account and network, and
  identical checks in flight share one lookup. Failures and "not found" are never remembered.
- Typing still waits 700 ms after you stop; a wallet re-rendering the field with the same
  address no longer restarts the check.

## What changed in 0.2.1

- **Auto network, now the default.** Gideon works out which network the wallet page is on
  instead of using the popup's setting, and says why on the card
  ("network → testnet · from your wallet's account (you.testnet)"). In order:
  1. the page address: wallets with one host per network (MyNearWallet, Bitte, Mintbase,
     NEAR Wallet, NearBlocks…), `?network=` / `/testnet/` hints, `testnet.*` hosts;
  2. the signed-in account shown in the page's header or top bar (`you.testnet` / `you.near`);
     this is how Meteor, Intear and HOT, which switch network inside the app, are read;
  3. a lone "Testnet" or "Mainnet" badge, or account names elsewhere on the page that all agree;
  4. the recipient's own suffix (`.testnet` / `.near`);
  5. nothing at all (a 64-hex or 0x recipient on an unknown page): look the account up on both
     networks and check where it exists.
  Only 1 and 2 are trusted enough to stop a send for "wrong network". Weaker signals never block:
  the recipient's suffix wins and the card asks you to double-check.
- Testnet and Mainnet stay as manual overrides in the popup. 0.2.0 installs move to Auto once.
- In Auto, the popup's asset list shows both networks' tokens; picking one picks its network.
- The card fits phone screens and moves above the field when the keyboard is open.
- No new permissions. Page text used for Auto is read on the device; only the answer
  (network, how it was found, and the account it came from) goes to the extension's worker.

## What changed in 0.2.0

- Look shared with the website: Bricolage Grotesque, Newsreader and JetBrains Mono, light and dark themes, the Gate G.
- The Gate G plays the real verdict in the popup result and the in-page warning card.
- A Light / Dark / Auto control in the popup (Auto follows the device setting).
- NEAR logo in the popup footer.
- No functional changes and no new permissions.

## Rules for this package

- Read-only. It never signs, never sees keys, never moves funds.
- If a lookup fails, it says "couldn't check". It never says safe.
- Permissions: `storage`, plus host access only to the free APIs the engine
  calls. The content script runs on http(s) pages and reads the value of the
  recipient field you paste or type into; in Auto network mode it also reads, on the
  device, the page address and short texts that are a NEAR account name or a network
  badge. None of that page text is sent anywhere.
- Settings and contacts stay in `chrome.storage.local`.

## Phones (Android)

The extension isn't on the Chrome Web Store and doesn't need to be. Some
Android browsers load extensions from a file. None of these has been tested on
a real phone yet; the steps come from each browser's docs or user reports,
linked below.

Build the files on a computer and copy them to the phone:

- `npm run zip:extension`: `gideon-extension-0.3.1.zip` (Chromium browsers)
- `npm run zip:firefox -w @gideon/extension`: `gideon-extension-firefox-0.3.1.zip` (Firefox)

**Mises Browser** (Chromium). Menu → **Extensions** → turn on
**Developer mode** → **+ (from .zip/.crx/.user.js)** → pick
`gideon-extension-0.3.1.zip`. Keep it zipped. Mises unpacks it into its cache,
so clearing the browser's cache or data removes it; install again if so.
After installing a new version, reload any wallet tab that was already open
(otherwise its card says "Gideon was updated. Reload this page to keep checking.").
([steps](https://github.com/lukman754/Mentari-Unpam),
[Play listing](https://play.google.com/store/apps/details?id=site.mises.browser_stable),
[no load-from-folder](https://github.com/mises-id/mises-browser-core/issues/332))

**Quetta** (Chromium). Settings → **Extensions** → **Developer mode** →
**from .zip/.crx/.user.js** → pick the same zip. One release dropped
sideloaded extensions (fixed in 1.8.2).

**Yandex Browser.** Officially it installs from the Chrome Web Store and
Opera add-ons. For testing: unzip `gideon-extension-0.3.1.zip` into a phone
folder, open `browser://extensions`, turn on **Developer mode**, tap **Load
unpacked extension** and pick `manifest.json` in that folder. Users reported
in 2020 that newer builds stopped loading unpacked extensions, so this may not
work on your version.
([Yandex help](https://yandex.com/support/browser-mobile-android-phone/en/personal-settings/extensions),
[yandex/browser-extensions](https://github.com/yandex/browser-extensions))

**Microsoft Edge.** Stable Edge for Android only offers a short curated list.
Edge Canary: Settings → About → tap the build number 5 times → **Developer
options** → **Extension install by id** (Edge Add-ons IDs only; Gideon has
none) or, on newer Canary builds, install from a `.crx`. Not a practical route
today.

**Firefox for Android (142+, Android 10+).** Firefox only installs signed
add-ons. Signing is free on [addons.mozilla.org](https://addons.mozilla.org)
(listed, or unlisted "on your own" self-distribution) but needs a Mozilla
account, so this repo ships the unsigned build only. Once you have the signed
`.xpi`: Settings → **About Firefox** → tap the Firefox logo 5 times → back to
Settings → **Install extension from file** → pick the `.xpi`. Developers can
also load the unsigned build temporarily over USB with
`npx web-ext run --target=firefox-android -s apps/extension/dist-firefox`.
([self-distributed install](https://extensionworkshop.com/documentation/publish/install-self-distributed/),
[data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/))

The Firefox build uses a background script instead of a service worker, adds
an add-on id and declares its data use (`websiteContent`,
`financialAndPaymentInfo`: the pasted address is looked up on the public APIs
listed above). `web-ext lint` passes with 0 errors.
