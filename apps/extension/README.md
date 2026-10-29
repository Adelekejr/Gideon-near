# apps/extension

The Gideon browser extension for Chrome (Manifest V3). It bundles the same
engine as the CLI and website (`@gideon/core` and `@gideon/sources`).

## Install (Load unpacked)

```bash
npm install
npm run build:extension      # → apps/extension/dist
npm run zip:extension        # → apps/extension/gideon-extension-0.2.3.zip
```

Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**
and choose `apps/extension/dist` (or an unzipped copy of the zip).

## How it's put together

| File | Job |
| --- | --- |
| `src/background.ts` | Service worker. Runs `check()` with the free live sources, adds your network and address book, keeps the stats and the last page check. |
| `src/content.ts` | Watches paste and typing in recipient-looking fields, asks the worker to check, shows the warning in a closed shadow root under the field, and holds the page's Send button on STOPPED. Also the in-page clipboard check (R9). |
| `src/popup.ts`, `popup.html` | The popup: shift picker (AUTO by default: Day from 06:00, Night Watch from 18:30; Blueprint and Signal Box are manual), manual check, last page check, guards, network switch, address book. Footer shows the NEAR logo (NEAR Foundation trademark, used per their brand guidelines). |
| `src/lib/detect.ts` | Which fields are recipients, which values are worth checking, which buttons to hold. |
| `src/lib/clipboard.ts` | What you copied on this page (forgotten after 2 minutes, on blur or tab switch), and whether a page swapped it. |
| `src/lib/view.ts`, `style.ts` | The verdict card and its styles, in the same fonts and shift colours as the website. Vermilion only for STOPPED, amber for look again or couldn't check, green for looks right. |
| `src/lib/motion.ts` | Plays the Arrow G on each real result: bounces on STOPPED, waits at an amber wall on look again, passes on looks right. Under 1.2 s; final pose only with reduced motion. |
| `src/lib/shift.ts` | The shift choice, saved in `chrome.storage.local` under its own key. |
| `build.mjs` | Vite IIFE builds for each entry, copies `static/`, `popup.html` and `manifest.json`, and writes the zip. |
| `src/lib/network.ts`, `resolve.ts` | Auto network: reads the page address and short account-name / "Testnet" badge texts on this device, then decides which network to check on (see below). |
| `src/lib/place.ts` | Where the card goes: under the field, or above it when a phone keyboard leaves no room; never wider than the screen. |
| `test-page/meteor-send.html` | A local reconstruction of Meteor Wallet's send screen (its public strings, not its markup) for testing Auto network. `?account=you.near`, `?menu=1`. |
| `test-page/withdraw.html` | A local, fake withdrawal page for trying it. `?hijack=1` simulates a page that swaps copied addresses. |
| `scripts/screenshots.mjs` | Loads `dist/` into Playwright's Chromium and takes the screenshots in `/shots`. Needs `playwright-core` and `npx playwright install chromium`. |

Tests are in `test/` and run with the root `npm test`.

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

- New look shared with the website: Archivo and JetBrains Mono, the four shifts plus AUTO, the Arrow G.
- The Arrow G plays the real verdict in the popup result and the in-page warning card.
- A shift picker in the popup (default AUTO).
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
