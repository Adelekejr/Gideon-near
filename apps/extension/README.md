# apps/extension

The Gideon browser extension for Chrome (Manifest V3). It bundles the same
engine as the CLI and website (`@gideon/core` and `@gideon/sources`).

## Install (Load unpacked)

```bash
npm install
npm run build:extension      # → apps/extension/dist
npm run zip:extension        # → apps/extension/gideon-extension-0.1.0.zip
```

Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**
and choose `apps/extension/dist` (or an unzipped copy of the zip).

## How it's put together

| File | Job |
| --- | --- |
| `src/background.ts` | Service worker. Runs `check()` with the free live sources, adds your network and address book, keeps the stats and the last page check. |
| `src/content.ts` | Watches paste and typing in recipient-looking fields, asks the worker to check, shows the warning in a closed shadow root under the field, and holds the page's Send button on STOPPED. Also the in-page clipboard check (R9). |
| `src/popup.ts`, `popup.html` | The night-panel popup: manual check, last page check, guards, network switch, address book. |
| `src/lib/detect.ts` | Which fields are recipients, which values are worth checking, which buttons to hold. |
| `src/lib/clipboard.ts` | What you copied on this page (forgotten after 2 minutes, on blur or tab switch), and whether a page swapped it. |
| `src/lib/view.ts`, `style.ts` | The verdict card and its styles. Vermilion only for STOPPED, amber for look again or couldn't check, green for looks right. |
| `build.mjs` | Vite IIFE builds for each entry, copies `static/`, `popup.html` and `manifest.json`, and writes the zip. |
| `test-page/withdraw.html` | A local, fake withdrawal page for trying it. `?hijack=1` simulates a page that swaps copied addresses. |
| `scripts/screenshots.mjs` | Loads `dist/` into Playwright's Chromium and takes the screenshots in `/shots`. Needs `playwright-core` and `npx playwright install chromium`. |

Tests are in `test/` and run with the root `npm test`.

## Rules for this package

- Read-only. It never signs, never sees keys, never moves funds.
- If a lookup fails, it says "couldn't check". It never says safe.
- Permissions: `storage`, plus host access only to the free APIs the engine
  calls. The content script runs on http(s) pages but reads only the value of
  the recipient field you paste or type into.
- Settings and contacts stay in `chrome.storage.local`.
