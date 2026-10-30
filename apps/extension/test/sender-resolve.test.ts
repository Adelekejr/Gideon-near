// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { signedInAccount } from "../src/lib/network.js";
import { fits, rememberAccount, rememberSend, resolveSender, senderHint, sendsOn, shortened } from "../src/lib/sender.js";
import { checkKey } from "../src/lib/runcache.js";
import { shouldCheck, plainTrim } from "../src/lib/detect.js";
import { senderLine, findingsList } from "../src/lib/view.js";

describe("Meteor's shortened header (hammed-st...testnet)", () => {
  it("is never taken as the sender itself", () => {
    expect(signedInAccount([{ text: "hammed-st...testnet", header: true }])).toBeNull();
  });
  it("parses and fits the full name", () => {
    expect(shortened("hammed-st...testnet")).toEqual({ head: "hammed-st", tail: "testnet" });
    expect(shortened("hammed-st…testnet")).toEqual({ head: "hammed-st", tail: "testnet" });
    expect(fits("hammed-st...testnet", "hammed-stampdue.testnet")).toBe(true);
    expect(fits("hammed-st...testnet", "hammed-stampede.near")).toBe(false);
    expect(fits("hammed-st...testnet", "adelekejr.testnet")).toBe(false);
  });
  it("resolves from a full name elsewhere on the page", () => {
    const hint = senderHint([{ text: "hammed-st...testnet", header: true }, { text: "hammed-stampdue.testnet", header: false }, { text: "bob.testnet", header: false }]);
    expect(hint).toEqual({ shown: "hammed-st...testnet", candidates: ["hammed-stampdue.testnet"] });
    expect(resolveSender(hint, []).account).toBe("hammed-stampdue.testnet");
  });
  it("resolves from your accounts, never from contacts", () => {
    const hint = senderHint([{ text: "hammed-st...testnet", header: true }]);
    expect(resolveSender(hint, ["hammed-stampdue.testnet", "other.testnet"])).toEqual({
      account: "hammed-stampdue.testnet", why: "your wallet shows hammed-st...testnet; matched to your saved account" });
    const none = resolveSender(hint, []);
    expect(none.account).toBeNull();
    expect(none.why).toContain("Your accounts");
  });
  it("two accounts that fit → asks you to pick", () => {
    const r = resolveSender({ shown: "hammed-st...testnet" }, ["hammed-stampdue.testnet", "hammed-stone.testnet"]);
    expect(r.account).toBeNull();
    expect(r.why).toContain("more than one");
  });
  it("a full header name wins and is remembered", () => {
    const hint = senderHint([{ text: "hammed.testnet", header: true }]);
    expect(resolveSender(hint, []).account).toBe("hammed.testnet");
    expect(rememberAccount(["a.testnet"], "Hammed.testnet")).toEqual(["hammed.testnet", "a.testnet"]);
    expect(rememberAccount([], "hammed-st...testnet")).toEqual([]);
  });
});

describe("sends from this device", () => {
  it("remembers per network, newest first, no duplicates", () => {
    let l = rememberSend([], { network: "testnet", to: "ref-finance.testnet", at: 1 });
    l = rememberSend(l, { network: "mainnet", to: "x.near", at: 2 });
    l = rememberSend(l, { network: "testnet", to: "REF-finance.testnet", at: 3 });
    expect(sendsOn(l, "testnet")).toEqual(["ref-finance.testnet"]);
    expect(sendsOn(l, "mainnet")).toEqual(["x.near"]);
  });
  it("change the cache key", () => {
    const base = { to: "bob.testnet", network: "testnet" as const };
    expect(checkKey({ ...base, deviceSends: ["a.testnet"] })).not.toBe(checkKey(base));
  });
});

describe("card sender line", () => {
  it("shows the account and how it was found, or why not", () => {
    expect(senderLine({ account: "hammed-stampdue.testnet", why: "from your wallet's header" })).toContain("<b>sender →</b> hammed-stampdue.testnet · from your wallet");
    expect(senderLine({ account: null, why: "your wallet shows hammed-st...testnet (shortened)" })).toContain("couldn't tell");
    expect(senderLine({ account: null, why: "" })).toBe("");
    expect(typeof findingsList).toBe("function");
  });
});

describe("fake letters reach the check", () => {
  const field = Object.assign(document.createElement("input"), { name: "recipient", placeholder: "Recipient" });
  it("trims ordinary spaces only", () => {
    expect(plainTrim(" a.near\u00A0 ")).toBe("a.near\u00A0");
    expect(plainTrim("\uFEFFa.near\n")).toBe("\uFEFFa.near");
  });
  it("addresses with fake letters, hidden spaces or invisible characters are still checked", () => {
    const plain = document.createElement("input");
    expect(shouldCheck(plain, "bigbаnk101.near")).toBe(true); // Cyrillic а, unlabelled field
    expect(shouldCheck(plain, "ref\u200Bfinance.testnet")).toBe(true);
    expect(shouldCheck(field, "alice\u00A0.testnet")).toBe(true);
    expect(shouldCheck(plain, "hello there")).toBe(false);
  });
});

import { pageAccounts } from "../src/lib/wallets.js";
const store = (o: Record<string, string>) => ({ length: Object.keys(o).length, key: (i: number) => Object.keys(o)[i] ?? null, getItem: (k: string) => o[k] ?? null });

describe("any NEAR web wallet", () => {
  it("MyNearWallet: its own record of the signed-in account wins", () => {
    document.body.innerHTML = `<div class="user-account"><div class="account-wrapper" data-test-id="currentUser">hammed-stampdue.testnet</div></div>`;
    const page = pageAccounts(document, "https://testnet.mynearwallet.com/send-money/ref-finance.testnet", store({ "_4:wallet:active_account_id_v2": "hammed-stampdue.testnet" }));
    expect(page.wallet).toEqual({ name: "MyNearWallet", accounts: ["hammed-stampdue.testnet", "hammed-stampdue.testnet"] });
    expect(page.url).toBeUndefined(); // the recipient in /send-money/<id> is never the sender
    const hint = senderHint([], page);
    expect(resolveSender(hint, [])).toEqual({ account: "hammed-stampdue.testnet", why: "from MyNearWallet's signed-in account" });
  });
  it("a site's near-api-js sign-in, ?account_id= and the title", () => {
    document.body.innerHTML = "";
    document.title = "Swap · me.near";
    const page = pageAccounts(document, "https://dapp.example/?account_id=me.near&all_keys=ed25519%3Ax", store({ "app_wallet_auth_key": JSON.stringify({ accountId: "me.near", allKeys: ["ed25519:x"] }), other: "secret" }));
    expect(page).toEqual({ url: ["me.near"], dapp: ["me.near"], title: ["me.near"] });
    expect(resolveSender(senderHint([], page), []).account).toBe("me.near");
    expect(resolveSender(senderHint([], { url: ["me.near"] }), []).why).toBe("from the page address (account_id)");
    expect(resolveSender(senderHint([], { title: ["me.near"] }), []).why).toBe("from the page title");
  });
  it("different names → no guess, unless exactly one is yours", () => {
    const hint = senderHint([{ text: "alice.near", header: true }], { title: ["bob.near"] });
    expect(hint.ambiguous).toEqual(["alice.near", "bob.near"]);
    const r = resolveSender(hint, []);
    expect(r.account).toBeNull();
    expect(r.why).toContain("won't guess");
    expect(resolveSender(hint, ["bob.near"]).account).toBe("bob.near");
  });
  it("a shortened header that doesn't fit the URL's name → no guess", () => {
    const hint = senderHint([{ text: "hammed-st...testnet", header: true }], { url: ["bob.testnet"] });
    expect(hint.ambiguous).toBeTruthy();
    expect(resolveSender(senderHint([{ text: "hammed-st...testnet", header: true }], { url: ["hammed-stampdue.testnet"] }), []).account).toBe("hammed-stampdue.testnet");
  });
  it("64-hex accounts, full or shortened", () => {
    const hex = "9ebef819489ae5e6641cc5573740dadc751c35c3ae37c110e4fad8101494e418";
    expect(resolveSender(senderHint([{ text: hex, header: true }]), []).account).toBe(hex);
    expect(resolveSender(senderHint([{ text: "9ebef8...e418", header: true }]), [hex]).account).toBe(hex);
  });
  it("nothing on the page → no sender, no message", () => {
    expect(resolveSender(senderHint([], {}), [])).toEqual({ account: null, why: "" });
  });
});
