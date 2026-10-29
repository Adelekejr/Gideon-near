import { describe, expect, it } from "vitest";
import { acct, empty, find, run } from "./helpers.js";

const H = "89a46298b5f72a95c3205ec6dfc2e842860f1faf24e701de2ae03418f4126944";
const tron = { chain: "Tron" as const, hash: H, summary: "a TRX transfer", explorerUrl: "https://tronscan.org/#/transaction/" + H };

describe("R2 transaction hash pasted as an account", () => {
  it("Tron hash → BLOCKED with tronscan evidence", async () => {
    const r = await run({ to: H, network: "mainnet" }, empty({ tronTx: async () => tron }));
    expect(r.verdict).toBe("BLOCKED");
    expect(r.headline?.code).toBe("TX_HASH_AS_ACCOUNT");
    expect(r.headline?.evidence?.[0].url).toContain("tronscan.org");
  });
  it("Ethereum hash (looked up as 0x + hash) → BLOCKED", async () => {
    let asked = "";
    const r = await run({ to: H, network: "mainnet" }, empty({ ethTx: async (h) => { asked = h; return { ...tron, chain: "Ethereum", hash: h }; } }));
    expect(asked).toBe("0x" + H);
    expect(r.headline?.title).toMatch(/Ethereum/);
  });
  it("Bitcoin hash → BLOCKED", async () => {
    const r = await run({ to: H, network: "mainnet" }, empty({ btcTx: async () => ({ ...tron, chain: "Bitcoin" }) }));
    expect(r.headline?.title).toMatch(/Bitcoin/);
  });
  it("existing account → PASS without asking other chains", async () => {
    let asked = false;
    const r = await run({ to: H, network: "mainnet" }, empty({ viewAccount: async () => acct(2), tronTx: async () => { asked = true; return null; } }));
    expect(find(r, "R2")[0].status).toBe("PASS");
    expect(asked).toBe(false);
  });
  it("other chains unreachable → COULD_NOT_CHECK, not safe", async () => {
    const r = await run({ to: H, network: "mainnet" }, empty({ tronTx: async () => { throw new Error("TronGrid timed out"); } }));
    const f = find(r, "R2")[0];
    expect(f.status).toBe("COULD_NOT_CHECK");
    expect(f.detail).toContain("TronGrid timed out");
    expect(r.verdict).not.toBe("SAFE");
  });
  it("uppercase hex is normalised and checked", async () => {
    const r = await run({ to: H.toUpperCase(), network: "mainnet" }, empty({ tronTx: async (h) => (h === H ? tron : null) }));
    expect(r.headline?.code).toBe("TX_HASH_AS_ACCOUNT");
  });
  it("NEAR tx hash (base58) → BLOCKED as NEAR transaction", async () => {
    const tx = "DhdjMAngJrXTsHXGoD3t53da9c2boN2ZwcXHo6SvAAzu";
    const r = await run({ to: tx, network: "mainnet" }, empty({ nearTx: async () => ({ hash: tx, signer: "a.near", receiver: "b.near" }) }));
    expect(r.headline?.code).toBe("NEAR_TX_HASH");
  });
});
