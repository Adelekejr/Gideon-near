// Pure rules for the "Check, then send" page. No DOM, no wallet: unit-tested in test/sendgate.test.ts.
import type { Network, Verdict } from "@gideon/core";

/** Network the send page signs on. Set by config (VITE_GIDEON_SEND_NETWORK), never by a page control. */
export function sendNetwork(value: string | undefined): Network {
  if (value === undefined || value === "") return "testnet";
  if (value === "testnet" || value === "mainnet") return value;
  throw new Error(`VITE_GIDEON_SEND_NETWORK must be "testnet" or "mainnet", got "${value}"`);
}

/** "1.5" NEAR → yoctoNEAR as a decimal string. Exact (no floats). Throws on anything else. */
export function nearToYocto(amount: string): string {
  const s = amount.trim();
  if (!/^\d+(\.\d{1,24})?$/.test(s)) throw new Error("Enter an amount like 1 or 0.25 (up to 24 decimals).");
  const [whole, frac = ""] = s.split(".");
  const yocto = BigInt(whole) * 10n ** 24n + BigInt(frac.padEnd(24, "0"));
  if (yocto === 0n) throw new Error("Amount must be more than 0.");
  return yocto.toString();
}

/** Everything a check result is valid for. Any change means the check no longer applies. */
export function sendKey(network: Network, from: string, to: string, amount: string): string {
  return JSON.stringify([network, from, to.trim(), amount.trim()]);
}

export type GateKind = "connect" | "fill" | "check" | "checking" | "safe" | "attention" | "blocked" | "sending" | "sent";

export interface GateInput {
  account: string | null;
  key: string;
  amountOk: boolean;
  to: string;
  checking: boolean;
  /** Last finished check, and the key it was run for. */
  checked: { key: string; verdict: Verdict } | null;
  confirmed: boolean;
  sending: boolean;
  sentKey: string | null;
}

export interface Gate {
  kind: GateKind;
  /** The Send button is enabled. */
  canSend: boolean;
  /** ATTENTION: the "I checked, send anyway" box is shown. */
  showConfirm: boolean;
  /** Check button enabled. */
  canCheck: boolean;
}

/**
 * SAFE → Send enabled. ATTENTION → Send only after an explicit confirm.
 * BLOCKED → Send disabled, no override. Any edit to wallet, recipient or amount
 * throws the old check away. "Couldn't check" arrives as ATTENTION from the engine.
 */
export function gate(g: GateInput): Gate {
  const none = { canSend: false, showConfirm: false, canCheck: false };
  if (!g.account) return { kind: "connect", ...none };
  if (!g.to.trim() || !g.amountOk) return { kind: "fill", ...none };
  if (g.sending) return { kind: "sending", ...none };
  if (g.sentKey === g.key) return { kind: "sent", ...none };
  if (g.checking) return { kind: "checking", ...none };
  const fresh = g.checked && g.checked.key === g.key ? g.checked.verdict : null;
  if (!fresh) return { kind: "check", ...none, canCheck: true };
  if (fresh === "BLOCKED") return { kind: "blocked", ...none, canCheck: true };
  if (fresh === "ATTENTION") return { kind: "attention", canSend: g.confirmed, showConfirm: true, canCheck: true };
  return { kind: "safe", canSend: true, showConfirm: false, canCheck: true };
}
