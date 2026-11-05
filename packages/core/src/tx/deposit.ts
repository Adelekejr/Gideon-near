import { canonicalChain, judgeDeposit } from "../deposits.js";
import { tokenByContract } from "../data.js";
import type { Finding, Network, OneClickStatus } from "../types.js";
import { couldNotCheck, f } from "../rules/util.js";
import type { TxRequest } from "./decode.js";

const BRIDGE_METHODS = new Set(["init_transfer", "ft_withdraw", "mt_withdraw", "execute_intents", "withdraw", "deposit"]);
const HEX64 = /^[0-9a-f]{64}$/i;

interface Meta {
  deposit?: string;
  chain?: string;
  origin?: string;
  deadline?: number;
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

function firstStr(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

function parseTime(v: string): number | undefined {
  if (/^\d{10}$/.test(v)) return Number(v) * 1000;
  if (/^\d{13}$/.test(v)) return Number(v);
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

function readMeta(value: unknown, into: Meta, depth = 0) {
  if (depth > 2) return;
  const o = asRecord(parseMaybe(value));
  if (!o) return;
  into.deposit ??= firstStr(o, ["deposit_address", "depositAddress"]);
  into.chain ??= firstStr(o, ["destination_chain", "destinationChain", "to_chain", "toChain", "chain", "chain_id", "chainId"]);
  into.origin ??= firstStr(o, ["origin_asset", "originAsset", "origin_token", "token_in", "tokenIn"]);
  if (into.deadline == null) {
    const dl = firstStr(o, ["deadline", "expires_at", "expiresAt", "expiry"]);
    if (dl) into.deadline = parseTime(dl);
  }
  if (typeof o.msg === "string" || (o.msg && typeof o.msg === "object")) readMeta(o.msg, into, depth + 1);
}

function humanYocto(deposit: string): string | undefined {
  if (!/^\d+$/.test(deposit)) return undefined;
  const raw = BigInt(deposit);
  if (raw < 10n ** 22n) return undefined;
  const whole = raw / 10n ** 24n;
  const frac = (raw % 10n ** 24n).toString().padStart(24, "0").slice(0, 6).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

interface RawDep {
  address: string;
  sentAsset: string;
  symbol: string;
  amount?: string;
  claimed: boolean;
  argChain?: string;
  argOrigin?: string;
  argDeadlineMs?: number;
}

function collect(network: Network, txs: TxRequest[]): RawDep[] {
  const out: RawDep[] = [];
  const seen = new Set<string>();
  const add = (d: RawDep) => {
    const address = d.address.toLowerCase();
    if (!HEX64.test(address) || seen.has(address)) return;
    seen.add(address);
    out.push({ ...d, address });
  };
  for (const t of txs) {
    for (const a of t.actions) {
      if (a.type === "Transfer" && HEX64.test(t.receiverId)) {
        const amount = humanYocto(a.deposit);
        add({ address: t.receiverId, sentAsset: "native", symbol: "NEAR", claimed: false, ...(amount ? { amount } : {}) });
      }
      if (a.type !== "FunctionCall") continue;
      const meta: Meta = {};
      readMeta(a.args, meta);
      const recv = typeof asRecord(a.args)?.receiver_id === "string" ? String(asRecord(a.args)!.receiver_id) : "";
      const address = meta.deposit && HEX64.test(meta.deposit) ? meta.deposit
        : HEX64.test(recv) ? recv
        : HEX64.test(t.receiverId) ? t.receiverId
        : "";
      if (!address) continue;
      const ft = a.methodName.startsWith("ft_") || a.methodName.startsWith("mt_");
      const contract = ft ? t.receiverId.toLowerCase() : undefined;
      const known = contract ? tokenByContract(network, contract) : undefined;
      const symbol = known?.symbol ?? (contract ? (contract.length > 18 ? `${contract.slice(0, 12)}…` : contract) : "NEAR");
      const amount = !ft && a.type === "FunctionCall" ? humanYocto(a.deposit) : undefined;
      add({
        address,
        sentAsset: contract ? `nep141:${contract}` : "native",
        symbol,
        claimed: BRIDGE_METHODS.has(a.methodName) || !!meta.deposit,
        ...(amount ? { amount } : {}),
        ...(meta.chain ? { argChain: meta.chain } : {}),
        ...(meta.origin ? { argOrigin: meta.origin } : {}),
        ...(meta.deadline != null ? { argDeadlineMs: meta.deadline } : {}),
      });
    }
  }
  return out;
}

function localFindings(dep: RawDep, now: number, bridgeChain?: string): Finding[] {
  const out: Finding[] = [];
  const ev = [{ label: "Deposit address", value: dep.address }];
  if (dep.argOrigin && !sameEnough(dep.sentAsset, dep.argOrigin)) {
    out.push(f("T8", "BLOCKED", "WRONG_ASSET_FOR_DEPOSIT", "This deposit is for a different token",
      `You're sending ${dep.symbol}, but the transaction says this deposit expects ${dep.argOrigin}.`,
      { fix: ["Send the token the deposit was made for, or start a new quote."], evidence: ev }));
  }
  if (dep.argDeadlineMs != null && dep.argDeadlineMs < now) {
    out.push(f("T8", "BLOCKED", "QUOTE_EXPIRED", "This quote has expired",
      "The transaction says this deposit's deadline has passed. A deposit now will be refunded at best.",
      { fix: ["Get a new quote in the swap app."], evidence: ev }));
  }
  const named = bridgeChain?.trim() || dep.argChain?.trim();
  if (named && (dep.claimed || bridgeChain?.trim())) {
    out.push(f("T8", "ATTENTION", "CHAIN_UNCONFIRMED", "Payout chain isn't confirmed",
      `This was described as paying out on ${canonicalChain(named)}, but Gideon has no quote that says so. That isn't a match.`,
      { fix: ["Check the payout chain in the swap app before you send."], evidence: ev }));
  }
  return out;
}

function sameEnough(sent: string, origin: string): boolean {
  const a = sent.toLowerCase().replace(/^nep141:/, "");
  const b = origin.toLowerCase().replace(/^nep141:/, "");
  return a === b || ((a === "native" || a === "near") && (b === "native" || b === "near"));
}

/**
 * T8 — a transaction that funds a 1Click or bridge deposit.
 * Wrong chain, wrong token, or an expired quote is BLOCKED.
 * 1Click down, or a deposit the quote doesn't know, is LOOK AGAIN. Never a silent pass.
 * A plain 64-character account 1Click doesn't know is left to the other checks.
 */
export async function depositTxFindings(
  network: Network,
  txs: TxRequest[],
  now: number,
  lookup: (address: string) => Promise<OneClickStatus | null>,
  bridgeChain?: string,
): Promise<Finding[]> {
  const deps = collect(network, txs).slice(0, 3);
  const out: Finding[] = [];
  for (const dep of deps) {
    let status: OneClickStatus | null;
    try {
      status = await lookup(dep.address);
    } catch (e) {
      out.push(couldNotCheck("T8", "whether this is a NEAR Intents deposit address", e instanceof Error ? e.message : String(e)));
      continue;
    }
    if (!status) {
      const local = localFindings(dep, now, bridgeChain);
      if (local.length) out.push(...local);
      else if (dep.claimed) {
        out.push(f("T8", "ATTENTION", "UNKNOWN_DEPOSIT_ADDRESS", "1Click doesn't know this deposit address",
          "This transaction names a deposit address, but 1Click has no swap for it.",
          { fix: ["Copy the deposit address again from the swap app, or start a new quote."],
            evidence: [{ label: "Deposit address", value: dep.address }] }));
      }
      continue;
    }
    out.push(...judgeDeposit("T8", {
      address: dep.address,
      network,
      sentAsset: dep.sentAsset,
      symbol: dep.symbol,
      ...(dep.amount ? { amount: dep.amount } : {}),
      ...(bridgeChain ? { bridgeChain } : {}),
      ...(dep.argChain ? { argChain: dep.argChain } : {}),
      ...(dep.argOrigin ? { argOrigin: dep.argOrigin } : {}),
      ...(dep.argDeadlineMs != null ? { argDeadlineMs: dep.argDeadlineMs } : {}),
      now,
      status,
    }));
  }
  return out;
}
