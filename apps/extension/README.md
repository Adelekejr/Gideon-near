# apps/extension (scaffold)

The Gideon browser extension. **Not built yet.** This folder holds the
Manifest V3 stub and icons so the plan has a home. It loads in Chrome
(`chrome://extensions` → Load unpacked → this folder), but does nothing yet.

The behaviour it will have is shown, with the real engine running live, on
the website's Extension page (`apps/web/extension.html`).

## Plan

1. A content script listens for `paste` into address-like fields on a page.
2. It runs `check()` from `@gideon/core` with `liveSources()` from
   `@gideon/sources` on the pasted value. It also passes what was copied
   (`input.clipboard`), so rule R9 can catch clipboard hijackers.
3. On `BLOCKED`, it shows the reason and fix beside the field and holds the
   page's Send/Withdraw button. On `ATTENTION`, it warns. On `SAFE`, it stays quiet.
4. Saved contacts live in `chrome.storage.local`, never on a server.
5. Network: testnet by default, with a mainnet switch in the popup.

## Rules for this package

- Read-only. It never signs, never sees keys, never moves funds.
- If a lookup fails, it says "couldn't check". It never says safe.
- Host permissions are requested per site, not `<all_urls>`, by default.
