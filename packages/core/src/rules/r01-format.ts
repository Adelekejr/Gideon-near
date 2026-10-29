import type { Ctx } from "../context.js";
import { networkOfName } from "../classify.js";
import { NETWORKS } from "../networks.js";
import { f, type RuleResult } from "./util.js";

const NAMED = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** R1 — input format and network. Local only. */
export function r01Format(ctx: Ctx): RuleResult {
  const { c, input } = ctx;
  const net = NETWORKS[input.network];
  switch (c.kind) {
    case "empty":
      return f("R1", "BLOCKED", "EMPTY", "Nothing to check", "Paste the address you are about to send to.");
    case "invalid": {
      const lower = c.normalized.toLowerCase();
      if (lower !== c.normalized && lower.length >= 2 && lower.length <= 64 && NAMED.test(lower)) {
        return f("R1", "BLOCKED", "UPPERCASE_NAME", "NEAR account names are lowercase",
          `"${c.normalized}" has capital letters, so it isn't a valid NEAR account. Did you mean "${lower}"?`,
          { fix: [`Check with the receiver, then use "${lower}".`] });
      }
      return f("R1", "BLOCKED", "INVALID_FORMAT", "This isn't a NEAR account",
        "It doesn't match the NEAR account format or any other chain's address format Gideon knows.",
        { fix: ["Copy the address again from the receiver's Deposit or Receive page."] });
    }
    case "tron-address":
      return f("R1", "BLOCKED", "WRONG_NETWORK_TRON", "That's a Tron address, not NEAR",
        "Addresses that start with T and have 34 characters belong to the Tron network. A NEAR send can't reach it.",
        { fix: ["Ask the receiver for their NEAR account (name.near / name.testnet or a 64-character account).", "If they only use Tron, use a bridge or swap to Tron instead of a NEAR send."] });
    case "btc-address":
      return f("R1", "BLOCKED", "WRONG_NETWORK_BTC", "That's a Bitcoin address, not NEAR",
        "This is a Bitcoin address format. A NEAR send can't reach it.",
        { fix: ["Ask the receiver for their NEAR account.", "To pay in BTC, use a swap (for example NEAR Intents) that delivers to Bitcoin."] });
    case "base58-32":
      return f("R1", "BLOCKED", "BASE58_NOT_NEAR", "Not a NEAR account (Solana address or a transaction hash)",
        "This mixed-case base58 string is the format of a Solana address, or of a NEAR or Solana transaction hash. NEAR accounts are lowercase.",
        { fix: ["Ask the receiver for their NEAR account (name.near / name.testnet or a 64-character account)."] });
    case "evm-tx-hash":
      return f("R1", "BLOCKED", "EVM_TX_HASH", "That's a transaction hash, not an address",
        "0x followed by 64 hex characters is the ID of a transaction on Ethereum or another EVM chain. Nobody owns it as an address.",
        { fix: ["Open the receiver's Deposit page, choose the NEAR network, and copy the address shown there."] });
    case "hex64-uppercase":
      return f("R1", "ATTENTION", "UPPERCASE_HEX", "64 hex characters with capital letters",
        "NEAR implicit accounts are all lowercase. Capitals usually mean this was copied from an explorer as a transaction or block hash.",
        { fix: ["Check where you copied this from. A receive address from a NEAR wallet is lowercase."] });
    case "eth-implicit":
      return f("R1", "PASS", "FORMAT_ETH_IMPLICIT", "Ethereum-style NEAR account format", "0x + 40 hex is a valid NEAR eth-implicit account. R4 checks it.");
    case "near-implicit":
      return f("R1", "PASS", "FORMAT_IMPLICIT", "NEAR implicit account format", "64 lowercase hex characters. R2 checks it isn't a pasted transaction hash.");
    case "near-named": {
      const home = networkOfName(c.normalized);
      if (home && home !== input.network) {
        return f("R1", "BLOCKED", "NETWORK_MISMATCH", `That's a ${home} name, but you're sending on ${input.network}`,
          `Names ending in ${home === "mainnet" ? ".near" : ".testnet"} live on NEAR ${home}. On ${net.label} this name is a different account, or none at all.`,
          { fix: [`Switch your wallet to ${home}, or ask the receiver for their ${net.accountSuffix} account.`] });
      }
      return f("R1", "PASS", "FORMAT_NAMED", "Named NEAR account format", `Valid account name for ${net.label}.`);
    }
  }
}
