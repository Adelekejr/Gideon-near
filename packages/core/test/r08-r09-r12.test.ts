import { describe, expect, it } from "vitest";
import { acct, empty, find, run, NOW } from "./helpers.js";
import { check } from "../src/engine.js";
import { newReceiptKey, verifyReceipt } from "../src/receipt.js";
import { exchangesFor } from "../src/data.js";

const live = empty({ viewAccount: async () => acct(1), ftMetadata: async () => ({ name: "Wrapped NEAR", symbol: "wNEAR", decimals: 24 }), storageRegistered: async () => true });

describe("R8 exchange registry", () => {
  it("wNEAR to an exchange → ATTENTION with an unwrap fix, never BLOCKED", async () => {
    const r = await run({ to: "deposit.testnet", destination: "exchange", exchange: "binance", asset: { symbol: "wNEAR", contract: "wrap.testnet" } }, live);
    expect(r.verdict).toBe("ATTENTION");
    expect(r.headline?.code).toBe("EXCHANGE_MAY_NOT_CREDIT");
    expect(r.headline?.title).toMatch(/\(unconfirmed\)/);
    expect(r.headline?.fix?.[0]).toMatch(/Unwrap/);
  });
  it("native NEAR to an exchange → PASS", async () => {
    const r = await run({ to: "deposit.testnet", destination: "exchange" }, live);
    expect(find(r, "R8")[0].status).toBe("PASS");
  });
  it("every network has a generic entry with a source or a note", () => {
    for (const n of ["mainnet", "testnet"] as const) {
      expect(exchangesFor(n).find((e) => e.id === "generic")).toBeTruthy();
      for (const e of exchangesFor(n)) expect(e.note.length).toBeGreaterThan(10);
    }
  });
});

describe("R9 clipboard", () => {
  it("copied ≠ pasted → BLOCKED", async () => {
    const r = await run({ to: "bob.testnet", clipboard: { copied: "b0b.testnet" } }, live);
    expect(r.headline?.code).toBe("CLIPBOARD_CHANGED");
  });
  it("copied = pasted → PASS", async () => {
    const r = await run({ to: "bob.testnet", clipboard: { copied: "bob.testnet" } }, live);
    expect(find(r, "R9")[0].status).toBe("PASS");
  });
});

describe("R12 receipt", () => {
  it("hash is stable and verifies; tampering is detected", async () => {
    const r = await check({ to: "bob.testnet", network: "testnet" }, live, { now: NOW });
    expect(r.receipt.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await verifyReceipt(r)).hashOk).toBe(true);
    expect((await verifyReceipt({ ...r, verdict: "BLOCKED" })).hashOk).toBe(false);
  });
  it("signed receipt verifies with ed25519", async () => {
    const key = newReceiptKey();
    const r = await check({ to: "bob.testnet", network: "testnet" }, live, { now: NOW, receiptKey: key });
    expect(r.receipt.signature).toMatch(/^[0-9a-f]{128}$/);
    expect(await verifyReceipt(r)).toEqual({ hashOk: true, signatureOk: true });
    const forged = { ...r, receipt: { ...r.receipt, sha256: "0".repeat(64) } };
    expect((await verifyReceipt(forged)).signatureOk).toBe(false);
  });
});
