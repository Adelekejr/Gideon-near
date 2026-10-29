import { describe, expect, it } from "vitest";
import { check } from "@gideon/core";
import { ClipboardWatch, COPY_TTL_MS, copyTampered } from "../src/lib/clipboard.js";
import { empty } from "../../../packages/core/test/helpers.js";

describe("ClipboardWatch", () => {
  it("remembers an address-like copy for a while", () => {
    const w = new ClipboardWatch();
    w.recordCopy("  hammed-stampdue.testnet ", 1000);
    expect(w.copiedFor(2000)).toBe("hammed-stampdue.testnet");
    expect(w.copiedFor(1000 + COPY_TTL_MS + 1)).toBeNull();
  });
  it("ignores copies that aren't addresses", () => {
    const w = new ClipboardWatch();
    w.recordCopy("hello there", 0);
    expect(w.copiedFor(1)).toBeNull();
  });
  it("forgets on reset (window blur / tab switch)", () => {
    const w = new ClipboardWatch();
    w.recordCopy("alice.near", 0);
    w.reset();
    expect(w.copiedFor(1)).toBeNull();
  });
});

describe("copyTampered", () => {
  it("flags a page that swaps the copied address", () => {
    expect(copyTampered("hammed-stampdue.testnet", "hammed-stampdve.testnet", true)).toBe("hammed-stampdve.testnet");
  });
  it("is quiet when nothing was swapped", () => {
    expect(copyTampered("alice.near", "alice.near", true)).toBeNull();
    expect(copyTampered("alice.near", "bob.near", false)).toBeNull();
    expect(copyTampered("Read more", "Read more — from example.com", true)).toBeNull();
  });
});

describe("R9 through the engine, as the extension calls it", () => {
  const s = empty({ viewAccount: async () => ({ amountYocto: "5000000000000000000000000", codeHash: "11111111111111111111111111111111", storageUsage: 182 }) });
  it("pasted ≠ copied → BLOCKED", async () => {
    const r = await check({ to: "hammed-stampdve.testnet", network: "testnet", clipboard: { copied: "hammed-stampdue.testnet" } }, s);
    expect(r.verdict).toBe("BLOCKED");
    expect(r.headline?.code).toBe("CLIPBOARD_CHANGED");
  });
  it("pasted = copied → R9 passes", async () => {
    const r = await check({ to: "hammed-stampdue.testnet", network: "testnet", clipboard: { copied: "hammed-stampdue.testnet" } }, s);
    expect(r.findings.find((f) => f.rule === "R9")?.status).toBe("PASS");
  });
});
