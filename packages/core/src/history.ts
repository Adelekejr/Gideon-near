import type { Ctx, Settled } from "./context.js";
import { networkOfName } from "./classify.js";
import type { Transfer } from "./types.js";

/** What the sender's recent history says, read once per check and shared by R3, R7 and R13. */
export interface SenderHistory {
  from: string;
  transfers: Transfer[];
  /** Accounts the sender sent to (signed transactions to), newest first. */
  pastRecipients: string[];
  /** Everyone else in the history: who sent to the sender, and receivers of txs it signed. */
  counterparties: Set<string>;
}

const ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/**
 * The sender account to compare with, or null when there is none or it can't be on this network
 * (a .near account while checking testnet). Lowercased and trimmed.
 */
export function senderOf(ctx: Ctx): string | null {
  const raw = ctx.input.from?.trim().toLowerCase().replace(/^@/, "");
  if (!raw || raw.length < 2 || raw.length > 64 || !ACCOUNT.test(raw)) return null;
  const home = networkOfName(raw);
  if (home && home !== ctx.input.network) return null;
  return raw;
}

/** History lookups are info-only and have their own (usually shorter) time limit. */
export function historyAsk(ctx: Ctx) {
  return { optional: true, timeoutMs: ctx.limits.historyTimeoutMs ?? ctx.limits.sourceTimeoutMs };
}

/** The sender's recent transactions (memoized per check). */
export async function senderHistory(ctx: Ctx): Promise<Settled<SenderHistory> | null> {
  const from = senderOf(ctx);
  if (!from) return null;
  const net = ctx.input.network;
  const r = await ctx.ask(`nearblocks-${net}`, `history:${from}`, (s) => s.recentTransfers(net, from), historyAsk(ctx));
  if (!r.ok) return r;
  const pastRecipients: string[] = [];
  const counterparties = new Set<string>();
  for (const t of r.value) {
    if (t.signer === from && t.receiver !== from) {
      if (!pastRecipients.includes(t.receiver)) pastRecipients.push(t.receiver);
    } else {
      if (t.signer !== from) counterparties.add(t.signer);
      if (t.receiver !== from) counterparties.add(t.receiver);
    }
  }
  for (const p of pastRecipients) counterparties.delete(p);
  return { ok: true, value: { from, transfers: r.value, pastRecipients, counterparties } };
}
