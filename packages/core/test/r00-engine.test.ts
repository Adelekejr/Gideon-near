import { describe, expect, it } from "vitest";
import { verdictOf } from "../src/engine.js";
import { acct, empty, fake, run } from "./helpers.js";
import type { Finding } from "../src/types.js";

const fx = (status: Finding["status"]): Finding => ({ rule: "R1", code: "X", status, title: "", detail: "" });

describe("verdict", () => {
  it("BLOCKED wins over everything", () => expect(verdictOf([fx("PASS"), fx("ATTENTION"), fx("BLOCKED")])).toBe("BLOCKED"));
  it("COULD_NOT_CHECK is never safe", () => expect(verdictOf([fx("PASS"), fx("COULD_NOT_CHECK")])).toBe("ATTENTION"));
  it("SAFE only when everything passed or was skipped", () => expect(verdictOf([fx("PASS"), fx("SKIPPED")])).toBe("SAFE"));
});

describe("engine", () => {
  it("every source down → ATTENTION with couldn't-check, never SAFE", async () => {
    const r = await run({ to: "hammed-stampdue.testnet" }, fake());
    expect(r.verdict).toBe("ATTENTION");
    expect(r.headline?.status).toBe("COULD_NOT_CHECK");
    expect(r.headline?.title).toMatch(/Couldn't check/);
  });

  it("a crashing rule source becomes COULD_NOT_CHECK, not SAFE", async () => {
    const r = await run({ to: "hammed-stampdue.testnet" }, fake({ viewAccount: () => { throw new Error("boom"); } }));
    expect(r.verdict).toBe("ATTENTION");
  });

  it("asks each source once per key (memoized)", async () => {
    let n = 0;
    const r = await run({ to: "a".repeat(64), network: "mainnet" }, empty({ viewAccount: async () => { n++; return acct(1); } }));
    expect(n).toBe(1);
    expect(r.verdict).toBe("SAFE");
  });

  it("defaults: asset NEAR, destination unknown", async () => {
    const r = await run({ to: "hammed-stampdue.testnet" }, empty({ viewAccount: async () => acct(10) }));
    expect(r.input.asset).toEqual({ symbol: "NEAR" });
    expect(r.input.destination).toBe("unknown");
    expect(r.findings.map((x) => x.rule)).toEqual(["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10", "R11", "R13", "R14", "R15", "R16"]);
  });
});
