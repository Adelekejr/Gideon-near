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
