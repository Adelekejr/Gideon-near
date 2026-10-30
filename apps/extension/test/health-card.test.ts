import { describe, expect, it } from "vitest";
import { HEALTH_TEXT, parseTxRequest, type AccountHealthResult, type KeyReport } from "@gideon/core";
import { healthCard } from "../src/lib/view.js";
import { sendHealth } from "../src/lib/messages.js";

const WALLET = "ed25519:DLZLLsmQK9RMa3FM3hXG6yYYrnPZrW8ZgMdiNwpiGiCz";
const OTHER = "ed25519:3yL6vEMhYcWiJ48tYWUnYw6TeiKN6rkFdWkavnfpc4xW";
const key = (k: Partial<KeyReport> & { publicKey: string }): KeyReport => ({
  kind: "full", addedAt: "2026-10-29T10:00:00.000Z", addedFrom: "nonce", uses: 1, lastUsedAt: null, probableWalletKey: false, flags: [], removable: true, ...k,
});
const result = (keys: KeyReport[], status: AccountHealthResult["status"] = "attention"): AccountHealthResult => ({
  engine: "test", kind: "account-health", account: "alice.testnet", network: "testnet", status, red: status === "danger",
  summary: status === "clean" ? HEALTH_TEXT.clean : HEALTH_TEXT.danger, moveFundsNow: status === "danger", advice: status === "danger" ? HEALTH_TEXT.moveFunds : null,
  keys, counts: { full: keys.filter((k) => k.kind === "full").length, app: keys.filter((k) => k.kind === "app").length, flagged: keys.filter((k) => k.flags.length).length },
  notes: [], sources: [], explorerUrl: "https://testnet.nearblocks.io/address/alice.testnet", checkedAt: "", ms: 1,
});
const red = { level: "red" as const, code: "UNKNOWN_FULL_KEY" as const, text: HEALTH_TEXT.unknownFull("29 Oct 2026") };

describe("Check my account card", () => {
  it("danger is vermilion with the move-funds advice and the approved footer", () => {
    const h = healthCard(result([key({ publicKey: WALLET, probableWalletKey: true }), key({ publicKey: OTHER, flags: [red] })], "danger"));
    expect(h).toContain('class="gw t-block"');
    expect(h).toContain("DANGER");
    expect(h).toContain(HEALTH_TEXT.moveFunds.slice(0, 30));
    expect(h).toContain(HEALTH_TEXT.footer.slice(0, 30));
    expect(h).toContain(HEALTH_TEXT.removeButton);
  });
  it("the remove step shows the confirmation and wallet links that sign as the wallet key, never signing itself", () => {
    const h = healthCard(result([key({ publicKey: WALLET, probableWalletKey: true }), key({ publicKey: OTHER, flags: [red] })], "danger"), { open: OTHER });
    expect(h).toContain("Your wallet will open");
    const href = /href="(https:\/\/wallet\.meteorwallet\.app\/connect\/testnet\/sign\?[^"]+)"/.exec(h)![1]!.replace(/&amp;/g, "&");
    const tx = parseTxRequest(href).transactions[0]!;
    expect(tx.actions[0]).toMatchObject({ type: "DeleteKey", publicKey: OTHER });
    expect(h).not.toContain("mynearwallet"); // testnet: Meteor only
  });
  it("the wallet key's links stay off until its warning is ticked", () => {
    const keys = [key({ publicKey: WALLET, probableWalletKey: true, flags: [red] }), key({ publicKey: OTHER })];
    const locked = healthCard(result(keys), { open: WALLET });
    expect(locked).toContain(HEALTH_TEXT.walletKey);
    expect(locked).toContain('data-tick="1"');
    expect(locked).not.toContain("href=\"https://wallet.meteorwallet.app");
    expect(healthCard(result(keys), { open: WALLET, ticked: true })).toContain("href=\"https://wallet.meteorwallet.app");
  });
  it("never offers to remove the only full control key", () => {
    const h = healthCard(result([key({ publicKey: WALLET, probableWalletKey: true, flags: [red] })]), { open: WALLET });
    expect(h).not.toContain("data-rm=");
    expect(h).not.toContain("meteorwallet");
    expect(h).toContain("This is the only full control key");
  });
  it("clean shows CLEAN and keeps unflagged keys in Details", () => {
    const h = healthCard(result([key({ publicKey: WALLET, probableWalletKey: true })], "clean"));
    expect(h).toContain('class="gw t-safe"');
    expect(h).toContain("CLEAN");
    expect(h).toContain("Details · 1 key");
  });
  it("sendHealth answers { ok: false } instead of throwing", async () => {
    expect(await sendHealth({ account: "a.testnet", network: "testnet" }, 50, async () => { throw new Error("no worker"); })).toEqual({ ok: false, error: "no worker" });
    expect(await sendHealth({ account: "a.testnet", network: "testnet" }, 50, async () => undefined)).toMatchObject({ ok: false });
  });
});
