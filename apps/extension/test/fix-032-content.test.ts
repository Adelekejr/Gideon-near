// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { encodeTransaction, toBase64, type TxCheckResult } from "@gideon/core";
import { greenAllowed } from "../src/lib/approval.js";

/*
 * 0.3.2 (audit-0.3.1 M3): any page can put `?transactions=` in its own address. Gideon then read it
 * and showed a green "nothing flagged" card on that page, the page vouching for itself. Now a green
 * card shows only on a known wallet; warnings still show everywhere.
 */
const KEY = "ed25519:" + "1".repeat(43);
const b64 = (n: string) => toBase64(encodeTransaction({ signerId: "me.near", publicKey: KEY, receiverId: n, actions: [{ type: "Transfer", deposit: "1" }] }));
const happy = (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM;
happy.setURL(`https://claim-airdrop.example/sign?transactions=${encodeURIComponent(b64("friend.near"))}`);

const attach = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (o: ShadowRootInit) { return attach.call(this, { ...o, mode: "open" }); };

const result = (verdict: TxCheckResult["verdict"]): TxCheckResult => {
  const headline = { rule: "T1", status: verdict === "SAFE" ? "PASS" : verdict, code: "X", title: verdict === "SAFE" ? "Nothing flagged, but check it yourself" : "Stop", detail: "" } as any;
  return { engine: "t", kind: "transaction", network: "mainnet", verdict, headline, findings: [headline], transactions: [], source: "sign-link", checkedAt: "2026-10-31T00:00:00Z", ms: 1 } as any;
};
let answer: TxCheckResult["verdict"] = "SAFE";
const sent: { type: string }[] = [];
vi.stubGlobal("chrome", {
  runtime: { id: "test", getURL: (p: string) => `chrome-extension://test/${p}`, sendMessage: async (m: { type: string }) => { sent.push(m); return { ok: true, result: result(answer) }; } },
  storage: { local: { get: async () => ({}), set: async () => undefined }, onChanged: { addListener: () => undefined } },
});
await import("../src/content.js");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const card = () => (document.querySelector("gideon-watch")?.shadowRoot?.textContent ?? "").replace(/\s+/g, " ");

describe("audit-0.3.1 M3: no green card on a page that isn't a wallet", () => {
  it("greenAllowed: wallets yes, look-alikes and other sites no", () => {
    for (const h of ["app.mynearwallet.com", "wallet.meteorwallet.app", "testnet.mynearwallet.com", "wallet.bitte.ai"]) expect(greenAllowed(h)).toBe(true);
    for (const h of ["claim-airdrop.example", "mynearwallet.com.evil.example", "mynearwal1et.com", "evilmeteorwallet.app"]) expect(greenAllowed(h)).toBe(false);
  });
  it("a SAFE answer on another site shows nothing", async () => {
    for (let i = 0; i < 50 && !sent.some((m) => m.type === "gideon:tx"); i++) await wait(20);
    await wait(100);
    expect(sent.some((m) => m.type === "gideon:tx")).toBe(true);
    expect(card()).toBe("");
  });
  it("a warning on the same site still shows", async () => {
    answer = "BLOCKED";
    happy.setURL(`https://claim-airdrop.example/sign?transactions=${encodeURIComponent(b64("other.near"))}`);
    document.body.appendChild(document.createElement("div"));
    for (let i = 0; i < 100 && !card().includes("Stop"); i++) await wait(20);
    expect(card()).toContain("Stop");
  });
});
