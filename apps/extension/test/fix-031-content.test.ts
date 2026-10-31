// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { encodeTransaction, toBase64 } from "@gideon/core";

/*
 * 0.3.1, the content script on a page: a failed approval check shows the COULDN'T CHECK card and
 * tries again (it used to stay silent), and events a page script makes up are ignored.
 * happy-dom events are never `isTrusted`, so these tests can only show the made-up side.
 */
const KEY = "ed25519:" + "1".repeat(43);
const b64 = toBase64(encodeTransaction({ signerId: "me.testnet", publicKey: KEY, receiverId: "bob.testnet", actions: [{ type: "Transfer", deposit: "1000000000000000000000000" }] }));
(window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(`https://testnet.mynearwallet.com/sign?transactions=${encodeURIComponent(b64)}&callbackUrl=https%3A%2F%2Fapp.example`);

// Gideon's card lives in a closed shadow root; open it so the test can read it.
const attach = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (o: ShadowRootInit) { return attach.call(this, { ...o, mode: "open" }); };

const sent: { type: string }[] = [];
const store: Record<string, unknown> = {};
vi.stubGlobal("chrome", {
  runtime: {
    id: "test", getURL: (p: string) => `chrome-extension://test/${p}`,
    sendMessage: async (m: { type: string }) => { sent.push(m); return { ok: false, error: "The worker didn't answer." }; },
  },
  storage: {
    local: {
      get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in store).map((k) => [k, store[k]])),
      set: async (o: Record<string, unknown>) => { Object.assign(store, o); },
    },
    onChanged: { addListener: () => undefined },
  },
});
await import("../src/content.js");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const card = () => (document.querySelector("gideon-watch")?.shadowRoot?.textContent ?? "").replace(/\s+/g, " ");

describe("fix 1: a failed approval check is never silent (extension page)", () => {
  it("shows COULDN'T CHECK with the approved text and a Try again button", async () => {
    for (let i = 0; i < 50 && !card(); i++) await wait(20);
    expect(sent.some((m) => m.type === "gideon:tx")).toBe(true);
    expect(card()).toContain("COULDN’T CHECK");
    expect(card()).toContain("Gideon couldn't finish checking this request.");
    expect(card()).toContain("That isn't a \"safe\". Don't approve until it can.");
    expect(card()).toContain("Try again");
    expect(card()).not.toContain("NO PROBLEMS FOUND");
  });
  it("tries again by itself after a wait (2 s first)", async () => {
    const before = sent.filter((m) => m.type === "gideon:tx").length;
    await wait(2300);
    expect(sent.filter((m) => m.type === "gideon:tx").length).toBe(before + 1);
    expect(card()).toContain("COULDN’T CHECK");
  });
});

describe("fix 4: made-up events are ignored (extension page)", () => {
  it("a page-script paste or typing into a recipient field starts no check", async () => {
    const input = document.createElement("input");
    input.name = "recipient";
    input.placeholder = "Recipient address";
    document.body.appendChild(input);
    const before = sent.filter((m) => m.type === "gideon:check").length;
    input.value = "bigbank101.near";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("paste", { bubbles: true }));
    await wait(900);
    expect(sent.filter((m) => m.type === "gideon:check").length).toBe(before);
  });
  it("a page-script click on Gideon's own 'Add to Your accounts' does nothing", async () => {
    const root = document.querySelector("gideon-watch")!.shadowRoot!;
    const b = document.createElement("button");
    b.dataset.act = "mine";
    b.dataset.account = "planted.near";
    root.querySelector(".g-root")!.appendChild(b);
    b.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    await wait(20);
    expect(store.myAccounts).toBeUndefined();
  });
});
