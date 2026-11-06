import { describe, expect, it } from "vitest";
import { isInvalidSuppliedAmount } from "../src/amounts.js";
import type { OneClickStatus } from "../src/types.js";
import { acct, empty, find, run, NOW } from "./helpers.js";

const D = "6560ef42e12a16195010ca95b194cd1385fa241a39ff6a9016cdea278c18afee";
const OTHER = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const wnear = { symbol: "wNEAR", contract: "wrap.near" };

const status = (s: string, originAsset = "nep141:wrap.near", deadline = new Date(NOW + 3600e3).toISOString()): OneClickStatus =>
  ({ status: s, quoteResponse: { quoteRequest: { originAsset, swapType: "EXACT_INPUT" }, quote: { depositAddress: D, deadline, amountInFormatted: "20.0" } } });

const src = (st: OneClickStatus | null) => empty({
  viewAccount: async () => acct(1),
  oneClickStatus: async () => st,
  storageRegistered: async () => true,
  ftMetadata: async () => ({ name: "Wrapped NEAR", symbol: "wNEAR", decimals: 24 }),
});

const safeAccount = empty({ viewAccount: async () => acct(1) });
const TO = "a".repeat(64);

describe("supplied amounts", () => {
  it("rejects 0, negative, non-decimal and exponential, and allows omitted", () => {
    for (const bad of ["-1", "0", "abc", "1e999", "1e24", "+2", "0.0"]) expect(isInvalidSuppliedAmount(bad)).toBe(true);
    expect(isInvalidSuppliedAmount(undefined)).toBe(false);
    expect(isInvalidSuppliedAmount("")).toBe(false);
    expect(isInvalidSuppliedAmount("  ")).toBe(false);
    expect(isInvalidSuppliedAmount("1")).toBe(false);
    expect(isInvalidSuppliedAmount("0.25")).toBe(false);
    expect(isInvalidSuppliedAmount(" 1.5 ")).toBe(false);
  });

  it("a supplied invalid amount is not SAFE just because it was ignored", async () => {
    const omitted = await run({ to: TO, network: "mainnet" }, safeAccount);
    expect(omitted.verdict).toBe("SAFE");
    const valid = await run({ to: TO, network: "mainnet", amount: "1.5" }, safeAccount);
    expect(valid.verdict).toBe("SAFE");
    expect(valid.findings.some((f) => f.code === "INVALID_AMOUNT")).toBe(false);

    for (const amount of ["-1", "0", "abc", "1e999"]) {
      const r = await run({ to: TO, network: "mainnet", amount }, safeAccount);
      expect(r.verdict, amount).not.toBe("SAFE");
      expect(r.findings.some((f) => f.code === "INVALID_AMOUNT" && f.status === "ATTENTION"), amount).toBe(true);
      expect(r.headline?.code, amount).toBe("INVALID_AMOUNT");
      expect(r.headline?.detail.toLowerCase(), amount).not.toMatch(/safe/);
    }
  });
});

describe("terminal Intents quotes", () => {
  it("a completed quote does not headline send wNEAR, and says not to fund it", async () => {
    const r = await run(
      { to: D, network: "mainnet", destination: "intents", asset: { symbol: "USDC", contract: USDC }, amount: "20" },
      src(status("SUCCESS")),
    );
    expect(r.verdict).toBe("BLOCKED");
    expect(r.headline?.code).toBe("DEPOSIT_ADDRESS_USED");
    expect(r.headline?.title.toLowerCase()).not.toContain("wnear");
    expect(`${r.headline?.title} ${r.headline?.detail}`.toLowerCase()).toMatch(/finished|done/);
    const guidance = r.findings.flatMap((f) => [f.title, f.detail, ...(f.fix ?? [])]).join(" ");
    expect(guidance).not.toMatch(/send .*instead|wrap near to wnear|fund this deposit/i);
    expect(guidance.toLowerCase()).toMatch(/don't fund|don't send/);
    expect(r.findings.some((f) => f.code === "WRONG_ASSET_FOR_DEPOSIT" || f.code === "NATIVE_FOR_WNEAR")).toBe(false);
  });

  it("a finished native-NEAR quote does not say to send wNEAR", async () => {
    const r = await run({ to: D, network: "mainnet", amount: "20" }, src(status("completed")));
    expect(r.headline?.code).toBe("DEPOSIT_ADDRESS_USED");
    expect(r.findings.some((f) => f.code === "NATIVE_FOR_WNEAR")).toBe(false);
    expect(r.findings.flatMap((f) => f.fix ?? []).join(" ")).not.toMatch(/wNEAR/);
  });

  it("an expired quote does not also tell you to fund a different token", async () => {
    const r = await run(
      { to: D, network: "mainnet", asset: { symbol: "USDC", contract: USDC } },
      src(status("PENDING_DEPOSIT", "nep141:wrap.near", new Date(NOW - 1000).toISOString())),
    );
    expect(r.headline?.code).toBe("QUOTE_EXPIRED");
    expect(r.headline?.detail.toLowerCase()).toMatch(/don't fund/);
    expect(r.findings.some((f) => f.code === "WRONG_ASSET_FOR_DEPOSIT")).toBe(false);
  });
});

describe("malformed 1Click quotes", () => {
  it("{} , a missing status, and a mismatched deposit address do not pass", async () => {
    const emptyBody = await run({ to: D, network: "mainnet", asset: wnear, destination: "intents" }, src({} as OneClickStatus));
    expect(emptyBody.verdict).not.toBe("SAFE");
    expect(find(emptyBody, "R6").some((f) => f.code === "DEPOSIT_ADDRESS_OK")).toBe(false);
    expect(find(emptyBody, "R6")[0].status).toBe("COULD_NOT_CHECK");

    const noStatus = await run(
      { to: D, network: "mainnet", asset: wnear },
      src({ quoteResponse: { quote: { depositAddress: D }, quoteRequest: { originAsset: "nep141:wrap.near" } } } as OneClickStatus),
    );
    expect(noStatus.verdict).not.toBe("SAFE");
    expect(find(noStatus, "R6").some((f) => f.code === "DEPOSIT_ADDRESS_OK")).toBe(false);

    const mismatch = await run(
      { to: D, network: "mainnet", asset: wnear },
      src({ ...status("PENDING_DEPOSIT"), quoteResponse: { ...status("PENDING_DEPOSIT").quoteResponse, quote: { ...status("PENDING_DEPOSIT").quoteResponse!.quote, depositAddress: OTHER } } }),
    );
    expect(mismatch.verdict).not.toBe("SAFE");
    expect(mismatch.headline?.code).toBe("DEPOSIT_ADDRESS_MISMATCH");
    expect(find(mismatch, "R6").some((f) => f.code === "DEPOSIT_ADDRESS_OK")).toBe(false);
  });
});
