import { describe, expect, it } from "vitest";
import { classify } from "../src/classify.js";
import { empty, find, run } from "./helpers.js";

describe("classify", () => {
  it.each([
    ["alice.near", "near-named"], ["hammed-stampdue.testnet", "near-named"],
    ["a".repeat(64), "near-implicit"], ["A".repeat(64), "hex64-uppercase"],
    ["0x" + "a".repeat(40), "eth-implicit"], ["0x" + "a".repeat(64), "evm-tx-hash"],
    ["TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "tron-address"],
    ["bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", "btc-address"],
    ["1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", "btc-address"],
    ["DhdjMAngJrXTsHXGoD3t53da9c2boN2ZwcXHo6SvAAzu", "base58-32"],
    ["", "empty"], ["not an address!", "invalid"], ["Alice.near", "invalid"],
  ])("%s → %s", (s, kind) => expect(classify(s).kind).toBe(kind));
});

describe("R1 format and network", () => {
  const r1 = async (to: string, network: "testnet" | "mainnet" = "testnet") => find(await run({ to, network }, empty()), "R1")[0];
  it("empty → BLOCKED", async () => expect((await r1("  ")).status).toBe("BLOCKED"));
  it("Tron address → BLOCKED and names Tron", async () => {
    const f = await r1("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "mainnet");
    expect(f.status).toBe("BLOCKED"); expect(f.title).toMatch(/Tron/);
  });
  it("Bitcoin address → BLOCKED", async () => expect((await r1("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")).code).toBe("WRONG_NETWORK_BTC"));
  it("base58 → BLOCKED (Solana or a hash)", async () => expect((await r1("DhdjMAngJrXTsHXGoD3t53da9c2boN2ZwcXHo6SvAAzu")).code).toBe("BASE58_NOT_NEAR"));
  it("0x + 64 hex → BLOCKED as EVM tx hash", async () => expect((await r1("0x" + "b".repeat(64))).code).toBe("EVM_TX_HASH"));
  it(".near on testnet → BLOCKED", async () => expect((await r1("alice.near", "testnet")).code).toBe("NETWORK_MISMATCH"));
  it(".testnet on mainnet → BLOCKED", async () => expect((await r1("bob.testnet", "mainnet")).code).toBe("NETWORK_MISMATCH"));
  it("uppercase name → BLOCKED with the lowercase suggestion", async () => {
    const f = await r1("Alice.testnet");
    expect(f.code).toBe("UPPERCASE_NAME"); expect(f.detail).toContain("alice.testnet");
  });
  it("uppercase 64-hex → ATTENTION", async () => expect((await r1("A".repeat(64))).status).toBe("ATTENTION"));
  it("valid name on the right network → PASS", async () => expect((await r1("bob.testnet")).status).toBe("PASS"));
});
