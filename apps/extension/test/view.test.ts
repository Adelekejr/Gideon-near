import { describe, expect, it } from "vitest";
import { check } from "@gideon/core";
import { card, esc, statusLabel, toneOf } from "../src/lib/view.js";
import { addContact, removeContact, withDefaults } from "../src/lib/settings.js";
import { empty, fake } from "../../../packages/core/test/helpers.js";

const live = empty({ viewAccount: async () => ({ amountYocto: "5000000000000000000000000", codeHash: "11111111111111111111111111111111", storageUsage: 182 }) });

describe("verdict colours", () => {
  it("vermilion only for BLOCKED", async () => {
    const r = await check({ to: "northwind-payro11.testnet", network: "testnet", addressBook: [{ account: "northwind-payroll.testnet", label: "Northwind payroll" }] }, live);
    expect(r.verdict).toBe("BLOCKED");
    expect(toneOf(r)).toBe("block");
    expect(card(r)).toContain('class="gw t-block"');
  });
  it("couldn't check is amber, never safe", async () => {
    const r = await check({ to: "bob.testnet", network: "testnet" }, fake());
    expect(r.verdict).not.toBe("SAFE");
    expect(toneOf(r)).toBe("warn");
    expect(statusLabel(r)).toBe("COULDN’T CHECK");
  });
  it("green for SAFE", async () => {
    const r = await check({ to: "bob.testnet", network: "testnet", destination: "wallet" }, live);
    expect(r.verdict).toBe("SAFE");
    expect(toneOf(r)).toBe("safe");
    expect(statusLabel(r)).toBe("LOOKS RIGHT");
  });
  it("escapes page-supplied text", async () => {
    expect(esc(`<img src=x onerror="a">`)).toBe("&lt;img src=x onerror=&quot;a&quot;&gt;");
    const r = await check({ to: "<b>x</b>", network: "testnet" }, live);
    expect(card(r)).not.toContain("<b>x</b>");
  });
});

describe("settings and address book", () => {
  it("defaults to testnet with every guard on", () => {
    expect(withDefaults({}).settings).toEqual({ network: "testnet", checkOnPaste: true, holdSend: true, clipboardCheck: true });
    expect(withDefaults({ settings: { network: "mainnet" } }).settings.network).toBe("mainnet");
    expect(withDefaults({ settings: { network: "devnet" } }).settings.network).toBe("testnet");
  });
  it("normalises and de-duplicates contacts", () => {
    let c = addContact([], " Alice.Near ", "Alice");
    c = addContact(c, "alice.near", "Alice 2");
    expect(c).toEqual([{ account: "alice.near", label: "Alice 2" }]);
    expect(removeContact(c, "alice.near")).toEqual([]);
  });
});
