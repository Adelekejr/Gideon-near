import { describe, expect, it } from "vitest";
import { lookalike, skeleton } from "../src/similarity.js";
import { acct, empty, find, run } from "./helpers.js";

describe("similarity", () => {
  it("1 vs l and rn vs m look the same", () => {
    expect(skeleton("payro11")).toBe(skeleton("payroll"));
    expect(skeleton("rnary")).toBe(skeleton("mary"));
  });
  it("named lookalikes", () => {
    expect(lookalike("northwind-payro11.testnet", "northwind-payroll.testnet")).toBeTruthy();
    expect(lookalike("alice.testnet", "bob.testnet")).toBeNull();
  });
  it("hex lookalike: same first and last 4", () => {
    const a = "abcd" + "1".repeat(56) + "wxyz".replace(/[wxyz]/g, "e");
    const b = "abcd" + "2".repeat(56) + "eeee";
    expect(lookalike(a, b)).toBeTruthy();
  });
});

describe("R7 lookalike and address poisoning", () => {
  const live = empty({ viewAccount: async () => acct(1) });
  it("lookalike of a saved contact → BLOCKED", async () => {
    const r = await run({ to: "northwind-payro11.testnet", addressBook: [{ account: "northwind-payroll.testnet", label: "Northwind payroll" }] }, live);
    expect(r.headline?.code).toBe("LOOKALIKE_OF_CONTACT");
  });
  it("exact saved contact → PASS", async () => {
    const r = await run({ to: "northwind-payroll.testnet", addressBook: [{ account: "northwind-payroll.testnet" }] }, live);
    expect(find(r, "R7")[0].code).toBe("SAVED_CONTACT");
    expect(r.verdict).toBe("SAFE");
  });
  const real = "a1b2" + "0".repeat(56) + "c3d4";
  const fakeAddr = "a1b2" + "f".repeat(56) + "c3d4";
  it("poisoning: lookalike of a counterparty that sent you dust → BLOCKED", async () => {
    const r = await run({ to: fakeAddr, from: "me.testnet" }, empty({
      viewAccount: async () => acct(1),
      recentTransfers: async () => [
        { hash: "t1", signer: "me.testnet", receiver: real, depositYocto: 5e24 },
        { hash: "t2", signer: fakeAddr, receiver: "me.testnet", depositYocto: 1e21 },
      ],
    }));
    expect(r.headline?.code).toBe("ADDRESS_POISONING");
  });
  it("lookalike of someone you sent to → BLOCKED, naming them", async () => {
    const r = await run({ to: fakeAddr, from: "me.testnet" }, empty({
      viewAccount: async () => acct(1),
      recentTransfers: async () => [{ hash: "t1", signer: "me.testnet", receiver: real, depositYocto: 5e24 }],
    }));
    expect(r.verdict).toBe("BLOCKED");
    expect(r.headline?.code).toBe("LOOKALIKE_OF_PAST_RECIPIENT");
    expect(r.headline?.detail).toContain(real);
  });
  it("lookalike of someone who only sent to you (no dust) → ATTENTION", async () => {
    const r = await run({ to: fakeAddr, from: "me.testnet" }, empty({
      viewAccount: async () => acct(1),
      recentTransfers: async () => [{ hash: "t1", signer: real, receiver: "me.testnet", depositYocto: 5e24 }],
    }));
    expect(find(r, "R7")[0].code).toBe("LOOKALIKE_OF_HISTORY");
    expect(find(r, "R7")[0].status).toBe("ATTENTION");
  });
  it("history unavailable → contacts only, never blocks the verdict", async () => {
    const r = await run({ to: "bob.testnet", from: "me.testnet" }, empty({ viewAccount: async () => acct(1), recentTransfers: async () => { throw new Error("NearBlocks rate limit reached"); } }));
    const r7 = find(r, "R7")[0];
    expect(r7.status).toBe("PASS");
    expect(r7.code).toBe("HISTORY_UNAVAILABLE");
    expect(r7.detail).toContain("rate limit");
    expect(r.sources.find((c) => c.source.includes("history:"))?.optional).toBe(true);
  });
  it("nothing to compare → SKIPPED", async () => {
    const r = await run({ to: "bob.testnet" }, live);
    expect(find(r, "R7")[0].status).toBe("SKIPPED");
  });
});

describe("R7 wider hex matching (contacts, device sends, history)", () => {
  const live = empty({ viewAccount: async () => acct(1) });
  const real = "9ebef819489ae5e6641cc5573740dadc751c35c3ae37c110e4fad8101494e418";
  const fake3x2 = real.slice(0, 3) + "0".repeat(59) + real.slice(62);
  const eth = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
  const ethFake = "0xd8da" + "1".repeat(32) + "6045";
  it("3+2 grind of a saved contact → BLOCKED", async () => {
    const r = await run({ to: fake3x2, addressBook: [{ account: real, label: "Exchange deposit" }] }, live);
    expect(r.headline?.code).toBe("LOOKALIKE_OF_CONTACT");
    expect(r.headline?.detail).toContain("Same first 3 and last 2 characters");
  });
  it("0x grind of a device send → BLOCKED", async () => {
    const r = await run({ to: ethFake, deviceSends: [eth] }, live);
    expect(r.headline?.code).toBe("LOOKALIKE_OF_PAST_RECIPIENT");
  });
  it("0x poisoning: lookalike past recipient that sent dust → ADDRESS_POISONING", async () => {
    const r = await run({ to: ethFake, from: "me.testnet" }, empty({
      viewAccount: async () => acct(1),
      recentTransfers: async () => [
        { hash: "t1", signer: "me.testnet", receiver: eth, depositYocto: 5e24 },
        { hash: "t2", signer: ethFake, receiver: "me.testnet", depositYocto: 0.5e21 },
      ],
    }));
    expect(r.headline?.code).toBe("ADDRESS_POISONING");
  });
  it("one character missing from a 64-hex history account → ATTENTION", async () => {
    const r = await run({ to: real.slice(0, 63), from: "me.testnet" }, empty({
      viewAccount: async () => acct(1),
      recentTransfers: async () => [{ hash: "t1", signer: real, receiver: "me.testnet", depositYocto: 5e24 }],
    }));
    const x = find(r, "R7")[0];
    expect(x.code).toBe("LOOKALIKE_OF_HISTORY");
    expect(x.detail).toContain("One character added or missing");
  });
});

