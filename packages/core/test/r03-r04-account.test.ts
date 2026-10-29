import { describe, expect, it } from "vitest";
import { acct, empty, find, run } from "./helpers.js";

describe("R3 account state", () => {
  it("missing named account → BLOCKED", async () => {
    const r = await run({ to: "nobody-here-123.testnet" }, empty());
    expect(r.verdict).toBe("BLOCKED"); expect(r.headline?.code).toBe("ACCOUNT_NOT_FOUND");
  });
  it("unused implicit account → ATTENTION", async () => {
    const r = await run({ to: "c".repeat(64) }, empty());
    expect(r.verdict).toBe("ATTENTION"); expect(r.headline?.code).toBe("IMPLICIT_UNFUNDED");
  });
  it("contract account when sending to a wallet → ATTENTION", async () => {
    const r = await run({ to: "app.testnet", destination: "wallet" }, empty({ viewAccount: async () => acct(1, "Fx2xyz") }));
    expect(find(r, "R3")[0].code).toBe("CONTRACT_ACCOUNT");
  });
  it("contract account with unknown destination → PASS", async () => {
    const r = await run({ to: "app.testnet" }, empty({ viewAccount: async () => acct(1, "Fx2xyz") }));
    expect(r.verdict).toBe("SAFE");
  });
  it("RPC down → COULD_NOT_CHECK", async () => {
    const r = await run({ to: "bob.testnet" }, empty({ viewAccount: async () => { throw new Error("rpc down"); } }));
    expect(find(r, "R3")[0].status).toBe("COULD_NOT_CHECK");
  });
});

describe("R4 Ethereum-style address", () => {
  const E = "0x94a0abA1283aF69Cb260b7e0Ea0366Dca0dd3cd8";
  it("never-used 0x address → ATTENTION", async () => {
    const r = await run({ to: E }, empty());
    expect(r.headline?.code).toBe("ETH_IMPLICIT_NEW");
  });
  it("0x account in use on NEAR → PASS", async () => {
    const r = await run({ to: E }, empty({ viewAccount: async () => acct(1) }));
    expect(find(r, "R4")[0].status).toBe("PASS");
  });
});
