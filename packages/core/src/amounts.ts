/** How many times a usual send the new amount must be before R19 says look again. 100 → 2000 is 20×. */
export const UNUSUAL_TIMES = 10;
/** At least this many earlier sends, or there is no "usual". */
export const MIN_USUAL_SAMPLES = 2;
/** Smaller than this (human units) is dust or a 1-yocto call deposit, not a send you meant. */
export const DUST_HUMAN = 0.01;

export function parseHumanAmount(amount: string | undefined): number | null {
  if (isInvalidSuppliedAmount(amount)) return null;
  if (!amount) return null;
  const s = amount.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * A supplied amount that is not a positive decimal (0, negative, text, exponential, absurd).
 * Blank and omitted are not invalid: address-only checks may leave the amount out.
 * Same spirit as the Send page: digits with an optional fraction, and it has to be more than 0.
 */
export function isInvalidSuppliedAmount(amount: string | null | undefined): boolean {
  if (amount == null) return false;
  const s = amount.trim();
  if (!s) return false;
  if (!/^\d+(\.\d+)?$/.test(s)) return true;
  const n = Number(s);
  return !(Number.isFinite(n) && n > 0);
}

export function formatUnits(raw: bigint, decimals: number): string {
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const d = Math.max(0, decimals);
  const base = 10n ** BigInt(d);
  const whole = v / base;
  const frac = d === 0 ? "" : (v % base).toString().padStart(d, "0").slice(0, 6).replace(/0+$/, "");
  const s = `${whole.toLocaleString("en-US")}${frac ? "." + frac : ""}`;
  return neg ? `-${s}` : s;
}

export function rawToHuman(raw: bigint, decimals: number): number {
  const base = 10n ** BigInt(Math.max(0, decimals));
  const whole = raw / base;
  const frac = raw % base;
  return Number(whole) + Number(frac) / Number(base);
}

/** "100", "1.5", "0.0042". */
export function formatHuman(n: number): string {
  if (!Number.isFinite(n)) return "?";
  if (n >= 100) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export function median(samples: number[]): number {
  const s = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * "unusual" = this amount is strictly more than every recent send and at least UNUSUAL_TIMES the median.
 * "none" = not enough earlier sends to call anything usual.
 */
export function judgeUnusual(current: number, samples: number[]): "unusual" | "usual" | "none" {
  const s = samples.filter((n) => Number.isFinite(n) && n >= DUST_HUMAN);
  if (s.length < MIN_USUAL_SAMPLES) return "none";
  const mid = median(s);
  const max = Math.max(...s);
  if (!(mid > 0) || !(current > 0)) return "none";
  if (current > max && current >= mid * UNUSUAL_TIMES) return "unusual";
  return "usual";
}
