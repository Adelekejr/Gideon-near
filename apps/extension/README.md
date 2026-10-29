# apps/extension

The Gideon browser extension for Chrome (Manifest V3). It bundles the same
engine as the CLI and website (`@gideon/core` and `@gideon/sources`).

## Install (Load unpacked)

```bash
npm install
npm run build:extension      # → apps/extension/dist
npm run zip:extension        # → apps/extension/gideon-extension-0.2.0.zip
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
| `test-page/withdraw.html` | A local, fake withdrawal page for trying it. `?hijack=1` simulates a page that swaps copied addresses. |
| `scripts/screenshots.mjs` | Loads `dist/` into Playwright's Chromium and takes the screenshots in `/shots`. Needs `playwright-core` and `npx playwright install chromium`. |

Tests are in `test/` and run with the root `npm test`.

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
  calls. The content script runs on http(s) pages but reads only the value of
  the recipient field you paste or type into.
- Settings and contacts stay in `chrome.storage.local`.
