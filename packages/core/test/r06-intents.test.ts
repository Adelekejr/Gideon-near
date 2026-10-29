import { describe, expect, it } from "vitest";
import { acct, empty, find, run, NOW } from "./helpers.js";
import type { OneClickStatus } from "../src/types.js";

const D = "6560ef42e12a16195010ca95b194cd1385fa241a39ff6a9016cdea278c18afee";
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const status = (s: string, originAsset = "nep141:wrap.near", deadline = new Date(NOW + 3600e3).toISOString()): OneClickStatus =>
  ({ status: s, quoteResponse: { quoteRequest: { originAsset, swapType: "EXACT_INPUT" }, quote: { depositAddress: D, deadline, amountInFormatted: "20.0" } } });
const src = (st: OneClickStatus | null) => empty({ viewAccount: async () => acct(0), oneClickStatus: async () => st, storageRegistered: async () => true,
  ftMetadata: async (_n, c) => (c === "wrap.near" ? { name: "Wrapped NEAR", symbol: "wNEAR", decimals: 24 } : { name: "USDC", symbol: "USDC", decimals: 6 }) });
const wnear = { symbol: "wNEAR", contract: "wrap.near" };

describe("R6 NEAR Intents deposit address (1Click, read-only)", () => {
  it("wrong token → BLOCKED and says what it expects", async () => {
    const r = await run({ to: D, network: "mainnet", destination: "intents", asset: { symbol: "USDC", contract: USDC } }, src(status("PENDING_DEPOSIT")));
    expect(r.headline?.code).toBe("WRONG_ASSET_FOR_DEPOSIT");
    expect(r.headline?.title).toContain("wNEAR");
  });
  it("finished swap → BLOCKED", async () => {
    const r = await run({ to: D, network: "mainnet", asset: wnear }, src(status("SUCCESS")));
    expect(find(r, "R6").map((x) => x.code)).toContain("DEPOSIT_ADDRESS_USED");
  });
  it("expired quote → BLOCKED", async () => {
    const r = await run({ to: D, network: "mainnet", asset: wnear }, src(status("PENDING_DEPOSIT", "nep141:wrap.near", new Date(NOW - 1000).toISOString())));
    expect(r.headline?.code).toBe("QUOTE_EXPIRED");
  });
  it("native NEAR to a wNEAR deposit → ATTENTION", async () => {
    const r = await run({ to: D, network: "mainnet" }, src(status("PENDING_DEPOSIT")));
    expect(r.headline?.code).toBe("NATIVE_FOR_WNEAR");
  });
  it("mainnet deposit address on testnet → BLOCKED", async () => {
    const r = await run({ to: D, network: "testnet", asset: { symbol: "wNEAR", contract: "wrap.testnet" } }, src(status("PENDING_DEPOSIT")));
    expect(find(r, "R6").map((x) => x.code)).toContain("MAINNET_DEPOSIT_ON_TESTNET");
  });
  it("live quote, right token → PASS and SAFE", async () => {
    const r = await run({ to: D, network: "mainnet", destination: "intents", asset: wnear }, src(status("PENDING_DEPOSIT")));
    expect(find(r, "R6")[0].code).toBe("DEPOSIT_ADDRESS_OK");
    expect(r.verdict).toBe("SAFE");
  });
  it("amount differs from an exact-input quote → ATTENTION", async () => {
    const r = await run({ to: D, network: "mainnet", asset: wnear, amount: "25" }, src(status("PENDING_DEPOSIT")));
    expect(r.headline?.code).toBe("AMOUNT_DIFFERS");
  });
  it("not a 1Click address → skipped quietly", async () => {
    const r = await run({ to: D, network: "mainnet" }, src(null));
    expect(find(r, "R6")[0].status).toBe("SKIPPED");
  });
  it("said 'intents' but 1Click doesn't know it → ATTENTION", async () => {
    const r = await run({ to: D, network: "mainnet", destination: "intents" }, src(null));
    expect(r.headline?.code).toBe("UNKNOWN_DEPOSIT_ADDRESS");
  });
  it("1Click down → COULD_NOT_CHECK", async () => {
    const r = await run({ to: D, network: "mainnet" }, empty({ viewAccount: async () => acct(0), oneClickStatus: async () => { throw new Error("1Click HTTP 503"); } }));
    expect(find(r, "R6")[0].status).toBe("COULD_NOT_CHECK");
    expect(r.verdict).toBe("ATTENTION");
  });
});
