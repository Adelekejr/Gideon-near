import { describe, expect, it } from "vitest";
import { acct, empty, find, run } from "./helpers.js";

const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const base = { to: "bob.near", network: "mainnet" as const };
const live = (over = {}) => empty({ viewAccount: async () => acct(1), ...over });

describe("R5 token preflight", () => {
  it("not a token → BLOCKED", async () => {
    const r = await run({ ...base, asset: { symbol: "USDC", contract: "random.near" } }, live());
    expect(r.headline?.code).toBe("NOT_A_TOKEN");
  });
  it("fake USDC on another contract → BLOCKED and names the real one", async () => {
    const r = await run({ ...base, asset: { symbol: "USDC", contract: "usdc-official.near" } },
      live({ ftMetadata: async () => ({ name: "USD Coin", symbol: "USDC", decimals: 6 }) }));
    expect(r.headline?.code).toBe("FAKE_TOKEN");
    expect(r.headline?.fix?.join(" ")).toContain(USDC);
  });
  it("receiver not registered → ATTENTION", async () => {
    const r = await run({ ...base, asset: { symbol: "USDC", contract: USDC } },
      live({ ftMetadata: async () => ({ name: "USDC", symbol: "USDC", decimals: 6 }) }));
    expect(r.headline?.code).toBe("NOT_REGISTERED");
  });
  it("real token, registered → SAFE", async () => {
    const r = await run({ ...base, asset: { symbol: "USDC", contract: USDC } },
      live({ ftMetadata: async () => ({ name: "USDC", symbol: "USDC", decimals: 6 }), storageRegistered: async () => true }));
    expect(r.verdict).toBe("SAFE");
  });
  it("bridged USDC.e → PASS with a note", async () => {
    const r = await run({ ...base, asset: { symbol: "USDC.e", contract: "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near" } },
      live({ ftMetadata: async () => ({ name: "USD Coin", symbol: "USDC", decimals: 6 }), storageRegistered: async () => true }));
    expect(find(r, "R5").map((x) => x.code)).toContain("BRIDGED_TOKEN");
    expect(r.verdict).toBe("SAFE");
  });
  it("token RPC down → COULD_NOT_CHECK", async () => {
    const r = await run({ ...base, asset: { symbol: "USDC", contract: USDC } }, live({ ftMetadata: async () => { throw new Error("x"); } }));
    expect(find(r, "R5")[0].status).toBe("COULD_NOT_CHECK");
  });
});
