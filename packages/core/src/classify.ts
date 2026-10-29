import type { Classification, Network } from "./types.js";

// NEAR account ID rules: https://docs.near.org/protocol/accounts-contracts/account-id
const NAMED = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const HEX64_LOWER = /^[0-9a-f]{64}$/;
const HEX64_ANY = /^[0-9a-fA-F]{64}$/;
const ETH_IMPLICIT = /^0x[0-9a-fA-F]{40}$/;
const EVM_TX = /^0x[0-9a-fA-F]{64}$/;
const TRON = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const BTC_BECH32 = /^bc1([02-9ac-hj-np-z]{39}|[02-9ac-hj-np-z]{59})$/;
const BTC_LEGACY = /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/;
const BASE58_32 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function classify(raw: string): Classification {
  const s = (raw ?? "").trim();
  if (!s) return { kind: "empty", normalized: "", label: "Nothing pasted" };
  if (HEX64_LOWER.test(s)) return { kind: "near-implicit", normalized: s, label: "NEAR implicit account (64 hex)" };
  if (HEX64_ANY.test(s)) return { kind: "hex64-uppercase", normalized: s.toLowerCase(), label: "64 hex characters with capitals" };
  if (EVM_TX.test(s)) return { kind: "evm-tx-hash", normalized: s.toLowerCase(), label: "0x + 64 hex (EVM transaction hash)" };
  if (ETH_IMPLICIT.test(s)) return { kind: "eth-implicit", normalized: s.toLowerCase(), label: "0x + 40 hex (Ethereum-style address)" };
  if (TRON.test(s)) return { kind: "tron-address", normalized: s, label: "Tron address" };
  if (BTC_BECH32.test(s)) return { kind: "btc-address", normalized: s, label: "Bitcoin address" };
  if (s.length >= 2 && s.length <= 64 && NAMED.test(s)) return { kind: "near-named", normalized: s, label: "Named NEAR account" };
  if (BTC_LEGACY.test(s)) return { kind: "btc-address", normalized: s, label: "Bitcoin address" };
  if (BASE58_32.test(s)) return { kind: "base58-32", normalized: s, label: "Base58 string (Solana address or a transaction hash)" };
  return { kind: "invalid", normalized: s, label: "Not a recognised address" };
}

/** ".near" names live on mainnet, ".testnet" names on testnet. */
export function networkOfName(name: string): Network | null {
  if (name.endsWith(".testnet") || name === "testnet") return "testnet";
  if (name.endsWith(".near") || name === "near") return "mainnet";
  return null;
}

export function isNearAccountKind(kind: Classification["kind"]): boolean {
  return kind === "near-named" || kind === "near-implicit" || kind === "eth-implicit";
}
