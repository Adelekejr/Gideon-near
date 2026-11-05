import type { TxAction, TxRequest } from "./decode.js";

const DUST = 10n ** 22n;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function positiveAmount(args: unknown): boolean {
  const o = asRecord(args);
  if (!o) return args == null;
  const v = o.amount ?? o.amounts;
  if (typeof v === "string" && /^[1-9]\d*$/.test(v.trim())) return true;
  if (typeof v === "number" && v > 0) return true;
  if (Array.isArray(v) && v.some((x) => typeof x === "string" && /^[1-9]\d*$/.test(x))) return true;
  return false;
}

function humanYocto(raw: bigint): string {
  const whole = raw / 10n ** 24n;
  const frac = (raw % 10n ** 24n).toString().padStart(24, "0").slice(0, 6).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/**
 * NEAR leaving the signer in this request (transfers and call deposits of at least 0.01 NEAR).
 * A fungible or NFT move is unpriced: the daily cap is in NEAR and can't cover it.
 * Unreadable transfer args are unpriced too.
 */
export function nearSpend(txs: TxRequest[]): { near: string | null; unpriced: boolean } {
  let y = 0n;
  let unpriced = false;
  for (const t of txs) {
    for (const a of t.actions) {
      if (a.type === "Transfer" && /^\d+$/.test(a.deposit)) {
        const d = BigInt(a.deposit);
        if (d >= DUST) y += d;
      }
      if (a.type !== "FunctionCall") continue;
      const call = a as Extract<TxAction, { type: "FunctionCall" }>;
      if (/^\d+$/.test(call.deposit)) {
        const d = BigInt(call.deposit);
        if (d >= DUST) y += d;
      }
      const movesToken = call.methodName.startsWith("ft_") || call.methodName.startsWith("mt_") || call.methodName.startsWith("nft_");
      if (movesToken && (call.args == null || positiveAmount(call.args))) unpriced = true;
    }
  }
  return { near: y > 0n ? humanYocto(y) : null, unpriced };
}
