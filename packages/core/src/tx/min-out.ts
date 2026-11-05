import { formatHuman, formatUnits, rawToHuman } from "../amounts.js";
import { tokenByContract } from "../data.js";
import type { Evidence, Finding, Network } from "../types.js";
import { f } from "../rules/util.js";
import type { TxAction, TxRequest } from "./decode.js";

/** A floor at or under this share of the amount going in is "far below" (1,000 → 50 is 5%). */
export const MIN_OUT_SHARE = 0.5;

const SWAP_METHODS = new Set(["swap", "swap_exact", "execute_swap"]);
const BRIDGE_METHODS = new Set(["init_transfer", "ft_withdraw", "mt_withdraw", "execute_intents", "withdraw"]);
const SWAP_CONTRACTS = new Set(["v2.ref-finance.near", "ref-finance-101.testnet"]);
const BRIDGE_CONTRACTS = new Set(["intents.near", "intents.testnet", "factory.bridge.near", "v2.omni.hot.tg", "bridge.hot.tg"]);

const MIN_KEYS = ["min_amount_out", "minAmountOut", "minimum_amount_out", "min_amount", "minAmount", "min_output", "min_out"];
const IN_KEYS = ["amount_in", "amountIn", "amount"];

export interface SwapLeg {
  amountIn: bigint;
  minOut: bigint;
  tokenIn?: string;
  tokenOut?: string;
  /** True when the call is a swap or a bridge, so a missing floor can be reported. */
  scoped: boolean;
  unreadable: boolean;
}

function isBridgeAccount(id: string): boolean {
  const a = id.toLowerCase();
  return BRIDGE_CONTRACTS.has(a) || SWAP_CONTRACTS.has(a)
    || a.endsWith(".factory.bridge.near") || a.endsWith(".omft.near") || a.endsWith(".bridge.near");
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function parseMaybe(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const s = v.trim();
  if (!s.startsWith("{") && !s.startsWith("[")) return v;
  try { return JSON.parse(s); } catch { return v; }
}

function intOf(v: unknown): bigint | null {
  if (typeof v === "bigint" && v > 0n) return v;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return BigInt(Math.trunc(v));
  if (typeof v !== "string" || !/^\d+$/.test(v.trim()) || v.trim() === "0") return null;
  return BigInt(v.trim());
}

function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (o[k] != null && o[k] !== "") return o[k];
  return undefined;
}

interface RawLeg { amountIn: bigint | null; minOut: bigint | null; tokenIn?: string; tokenOut?: string }

function walk(node: unknown, into: RawLeg[]) {
  const v = parseMaybe(node);
  if (Array.isArray(v)) {
    for (const x of v) walk(x, into);
    return;
  }
  const o = asRecord(v);
  if (!o) return;
  const minOut = intOf(pick(o, MIN_KEYS));
  const amountIn = intOf(pick(o, IN_KEYS));
  if (minOut || (amountIn && pick(o, MIN_KEYS) != null)) {
    into.push({
      amountIn, minOut,
      ...(typeof o.token_in === "string" ? { tokenIn: o.token_in } : typeof o.tokenIn === "string" ? { tokenIn: o.tokenIn } : {}),
      ...(typeof o.token_out === "string" ? { tokenOut: o.token_out } : typeof o.tokenOut === "string" ? { tokenOut: o.tokenOut } : {}),
    });
  }
  for (const [k, child] of Object.entries(o)) {
    if (MIN_KEYS.includes(k) || IN_KEYS.includes(k)) continue;
    if (child && typeof child === "object") walk(child, into);
    else if (typeof child === "string" && (child.trim().startsWith("{") || child.trim().startsWith("["))) walk(child, into);
  }
}

function ft(a: TxAction): a is Extract<TxAction, { type: "FunctionCall" }> {
  return a.type === "FunctionCall";
}

/** Swap and bridge legs Gideon can read from one request. */
export function swapLegs(txs: TxRequest[]): SwapLeg[] {
  const legs: SwapLeg[] = [];
  for (const t of txs) {
    for (const a of t.actions) {
      if (!ft(a)) continue;
      const receiver = t.receiverId.toLowerCase();
      const swap = SWAP_METHODS.has(a.methodName);
      const bridge = BRIDGE_METHODS.has(a.methodName) && (isBridgeAccount(receiver) || isBridgeAccount(String((asRecord(a.args)?.receiver_id) ?? "")));
      const refCall = a.methodName === "ft_transfer_call" && isBridgeAccount(String(asRecord(a.args)?.receiver_id ?? receiver));
      const scoped = swap || bridge || refCall;
      if (!scoped && a.methodName !== "ft_transfer_call") continue;
      if (a.args == null && a.argsBase64) {
        if (scoped) legs.push({ amountIn: 0n, minOut: 0n, scoped: true, unreadable: true });
        continue;
      }
      const raw: RawLeg[] = [];
      walk(a.args, raw);
      const ftAmount = a.methodName.startsWith("ft_") ? intOf(asRecord(a.args)?.amount) : null;
      const ftToken = a.methodName.startsWith("ft_") ? receiver : undefined;
      if (!raw.length) {
        if (swap) legs.push({ amountIn: 0n, minOut: 0n, scoped: true, unreadable: false });
        continue;
      }
      for (const r of raw) {
        if (!r.minOut && !scoped) continue;
        const amountIn = r.amountIn ?? ftAmount;
        if (!r.minOut || !amountIn) {
          if (scoped) legs.push({ amountIn: amountIn ?? 0n, minOut: r.minOut ?? 0n, scoped: true, unreadable: false, ...(r.tokenIn ? { tokenIn: r.tokenIn } : {}), ...(r.tokenOut ? { tokenOut: r.tokenOut } : {}) });
          continue;
        }
        legs.push({
          amountIn, minOut: r.minOut, scoped: scoped || true, unreadable: false,
          ...(r.tokenIn || ftToken ? { tokenIn: r.tokenIn ?? ftToken } : {}),
          ...(r.tokenOut ? { tokenOut: r.tokenOut } : {}),
        });
      }
    }
  }
  return legs;
}

function decimals(network: Network, token: string | undefined): number | null {
  if (!token) return null;
  const id = token.replace(/^nep141:/, "").toLowerCase();
  if (id === "near" || id === "wrap.near" || id === "wrap.testnet") return 24;
  return tokenByContract(network, id)?.decimals ?? null;
}

function symbol(network: Network, token: string | undefined, fallback: string): string {
  if (!token) return fallback;
  const id = token.replace(/^nep141:/, "").toLowerCase();
  if (id === "near") return "NEAR";
  return tokenByContract(network, id)?.symbol ?? (id.length > 18 ? `${id.slice(0, 10)}…` : id);
}

function farBelow(network: Network, leg: SwapLeg): boolean | null {
  const dIn = decimals(network, leg.tokenIn);
  const dOut = decimals(network, leg.tokenOut);
  if (leg.minOut <= 0n) return true;
  if (dIn == null || dOut == null) {
    // Same unknown scale: compare the integers. Different unknown scales are not a quote.
    if (dIn == null && dOut == null) return Number(leg.minOut) / Number(leg.amountIn) <= MIN_OUT_SHARE;
    return null;
  }
  const inn = rawToHuman(leg.amountIn, dIn);
  const out = rawToHuman(leg.minOut, dOut);
  if (!(inn > 0)) return null;
  return out / inn <= MIN_OUT_SHARE;
}

/**
 * T7 — swap or bridge minimum received is far below the amount going in.
 * LOOK AGAIN, never BLOCKED. This compares amounts in the args. It does not fetch a live market quote.
 * A swap whose args can't be read is COULD_NOT_CHECK.
 */
export function minOutFindings(network: Network, txs: TxRequest[]): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const leg of swapLegs(txs)) {
    if (leg.unreadable || (leg.scoped && leg.amountIn <= 0n && leg.minOut <= 0n)) {
      out.push(f("T7", "COULD_NOT_CHECK", "MIN_OUT_UNREADABLE", "Couldn't check: the minimum this swap or bridge would pay you",
        "Gideon couldn't read the minimum amount in the request, so it won't call the price fine. Look at the minimum in your wallet before you approve."));
      continue;
    }
    if (leg.amountIn <= 0n || leg.minOut < 0n) continue;
    const bad = farBelow(network, leg);
    if (bad == null) {
      out.push(f("T7", "COULD_NOT_CHECK", "MIN_OUT_UNREADABLE", "Couldn't check: the minimum this swap or bridge would pay you",
        "The amounts are in the request, but Gideon doesn't know both tokens' decimals, so it can't tell whether the minimum is far too low. This isn't called fine."));
      continue;
    }
    if (!bad) continue;
    const symIn = symbol(network, leg.tokenIn, "in");
    const symOut = symbol(network, leg.tokenOut, "out");
    const dIn = decimals(network, leg.tokenIn) ?? 0;
    const dOut = decimals(network, leg.tokenOut) ?? 0;
    const shownIn = dIn ? formatUnits(leg.amountIn, dIn) : formatHuman(Number(leg.amountIn));
    const shownOut = dOut ? formatUnits(leg.minOut, dOut) : formatHuman(Number(leg.minOut));
    const key = `${shownIn}|${shownOut}|${symIn}|${symOut}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ev: Evidence[] = [
      { label: "You send", value: `${shownIn} ${symIn}` },
      { label: "Minimum you receive", value: `${shownOut} ${symOut}` },
    ];
    out.push(f("T7", "ATTENTION", "MIN_OUT_LOW", "Look again: the minimum you receive is far below what you send",
      `This swap or bridge would send ${shownIn} ${symIn} and accept as little as ${shownOut} ${symOut} back. That is the kind of gap a tampered quote leaves (1,000 in, 50 back). Gideon is not blocking it: check the minimum in your wallet, and cancel if it isn't the quote you asked for.`,
      { evidence: ev }));
  }
  return out;
}
