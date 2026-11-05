import { fromBase64 } from "./tx/decode.js";
import type { AccountMove } from "./types.js";

const FT = new Set(["ft_transfer", "ft_transfer_call"]);

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

/** Function-call args: a JSON object, a JSON string, or base64 JSON. */
export function parseCallArgs(v: unknown): Record<string, unknown> | null {
  if (asRecord(v)) return asRecord(v);
  if (typeof v !== "string" || !v.trim()) return null;
  const text = v.trim();
  const tryJson = (s: string) => {
    try {
      return asRecord(JSON.parse(s));
    } catch {
      return null;
    }
  };
  const direct = tryJson(text);
  if (direct) return direct;
  try {
    return tryJson(new TextDecoder("utf-8", { fatal: true }).decode(fromBase64(text)));
  } catch {
    return null;
  }
}

function intString(v: unknown): string | null {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.trunc(v).toString();
  if (typeof v !== "string") return null;
  const s = v.trim();
  return /^\d+$/.test(s) && s !== "0" ? s.replace(/^0+(?=\d)/, "") : null;
}

function msOf(ns: unknown): number {
  const n = typeof ns === "number" ? ns : typeof ns === "string" ? Number(ns) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e15 ? Math.floor(n / 1e6) : Math.floor(n);
}

function push(out: AccountMove[], m: AccountMove) {
  if (!m.amount || m.amount === "0" || !m.counterparty || m.counterparty === m.asset) return;
  out.push(m);
}

/**
 * One FastNEAR /v0/transactions entry, from `account`'s point of view.
 * Native NEAR comes only from Transfer actions (a 1-yocto function-call deposit is not a send).
 * Token amounts come from ft_transfer / ft_transfer_call args.
 */
export function movesFromFastNear(account: string, transactions: unknown[]): AccountMove[] {
  const me = account.toLowerCase();
  const out: AccountMove[] = [];
  for (const row of transactions) {
    const t = asRecord(row);
    const tx = asRecord(t?.transaction);
    if (!tx) continue;
    const hash = String(tx.hash ?? "");
    const signer = String(tx.signer_id ?? "").toLowerCase();
    const receiver = String(tx.receiver_id ?? "").toLowerCase();
    const atMs = msOf(asRecord(t?.execution_outcome)?.block_timestamp);
    const actions = Array.isArray(tx.actions) ? tx.actions : [];
    for (const raw of actions) {
      const a = asRecord(raw);
      if (!a) continue;
      const transfer = asRecord(a.Transfer);
      if (transfer) {
        const amount = intString(transfer.deposit);
        if (!amount) continue;
        if (signer === me && receiver !== me) push(out, { hash, atMs, direction: "out", asset: "NEAR", counterparty: receiver, amount });
        else if (receiver === me && signer !== me) push(out, { hash, atMs, direction: "in", asset: "NEAR", counterparty: signer, amount });
        continue;
      }
      const call = asRecord(a.FunctionCall);
      if (!call) continue;
      const method = String(call.method_name ?? "");
      if (!FT.has(method)) continue;
      const args = parseCallArgs(call.args);
      const amount = intString(args?.amount);
      const who = typeof args?.receiver_id === "string" ? args.receiver_id.trim().toLowerCase() : "";
      if (!amount || !who || !receiver) continue;
      if (signer === me && who !== me) push(out, { hash, atMs, direction: "out", asset: receiver, counterparty: who, amount });
      else if (who === me && signer !== me) push(out, { hash, atMs, direction: "in", asset: receiver, counterparty: signer, amount });
    }
  }
  return out.sort((a, b) => b.atMs - a.atMs);
}

function nbActions(tx: Record<string, unknown>): { method: string; args: unknown }[] {
  const list = Array.isArray(tx.actions) ? tx.actions : [];
  const out: { method: string; args: unknown }[] = [];
  for (const raw of list) {
    const a = asRecord(raw);
    if (!a) continue;
    const method = String(a.method ?? a.method_name ?? asRecord(a.args)?.method_name ?? "");
    const args = a.args ?? asRecord(a.args)?.args_json ?? asRecord(a.args)?.args;
    const kind = String(a.action ?? a.action_kind ?? "");
    if (kind.toUpperCase().includes("TRANSFER") && !method) {
      out.push({ method: "TRANSFER", args: a });
      continue;
    }
    if (method) out.push({ method, args });
  }
  return out;
}

/** One NearBlocks txns-only row, from `account`'s point of view. */
export function movesFromNearBlocks(account: string, txns: unknown[]): AccountMove[] {
  const me = account.toLowerCase();
  const out: AccountMove[] = [];
  for (const row of txns) {
    const tx = asRecord(row);
    if (!tx) continue;
    const hash = String(tx.transaction_hash ?? tx.hash ?? "");
    const signer = String(tx.signer_account_id ?? tx.predecessor_account_id ?? "").toLowerCase();
    const receiver = String(tx.receiver_account_id ?? "").toLowerCase();
    const atMs = msOf(tx.block_timestamp);
    let sawNear = false;
    for (const a of nbActions(tx)) {
      if (a.method === "TRANSFER") {
        const deposit = intString(asRecord(a.args)?.deposit ?? asRecord(tx.actions_agg)?.deposit);
        if (!deposit) continue;
        sawNear = true;
        if (signer === me && receiver !== me) push(out, { hash, atMs, direction: "out", asset: "NEAR", counterparty: receiver, amount: deposit });
        else if (receiver === me && signer !== me) push(out, { hash, atMs, direction: "in", asset: "NEAR", counterparty: signer, amount: deposit });
        continue;
      }
      if (!FT.has(a.method)) continue;
      const args = parseCallArgs(a.args);
      const amount = intString(args?.amount);
      const who = typeof args?.receiver_id === "string" ? args.receiver_id.trim().toLowerCase() : "";
      if (!amount || !who || !receiver) continue;
      if (signer === me && who !== me) push(out, { hash, atMs, direction: "out", asset: receiver, counterparty: who, amount });
      else if (who === me && signer !== me) push(out, { hash, atMs, direction: "in", asset: receiver, counterparty: signer, amount });
    }
    if (!sawNear) {
      const deposit = intString(asRecord(tx.actions_agg)?.deposit);
      if (deposit) {
        if (signer === me && receiver !== me) push(out, { hash, atMs, direction: "out", asset: "NEAR", counterparty: receiver, amount: deposit });
        else if (receiver === me && signer !== me) push(out, { hash, atMs, direction: "in", asset: "NEAR", counterparty: signer, amount: deposit });
      }
    }
  }
  return out.sort((a, b) => b.atMs - a.atMs);
}

/** Both histories, newest first, one row per hash + direction + asset + counterparty + amount. */
export function mergeMoves(a: AccountMove[], b: AccountMove[]): AccountMove[] {
  const seen = new Set<string>();
  const out: AccountMove[] = [];
  for (const m of [...a, ...b]) {
    const k = `${m.hash}|${m.direction}|${m.asset}|${m.counterparty}|${m.amount}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out.sort((x, y) => y.atMs - x.atMs);
}
