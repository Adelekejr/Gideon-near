import { DUST_HUMAN, formatHuman, judgeUnusual, rawToHuman } from "../amounts.js";
import { tokenByContract } from "../data.js";
import { wellKnown } from "../known.js";
import type { AccountMove, Finding, Network, Sources } from "../types.js";
import { f } from "../rules/util.js";
import { collectorFromMoves, knownExchangeFinding } from "../rules/r20-collector.js";
import type { TxAction, TxRequest } from "./decode.js";

const NEAR = 10n ** 24n;
/** Ignore 1-yocto call deposits. A real NEAR send is at least 0.01 NEAR. */
const NEAR_DUST = NEAR / 100n;

interface Send {
  signer: string;
  contract?: string;
  symbol: string;
  decimals: number;
  human: number;
}

function ft(a: TxAction): a is Extract<TxAction, { type: "FunctionCall" }> {
  return a.type === "FunctionCall";
}

function argStr(args: unknown, k: string): string | undefined {
  const v = (args as Record<string, unknown> | null)?.[k];
  return typeof v === "string" || typeof v === "number" ? String(v).trim() : undefined;
}

function sendsOf(network: Network, txs: TxRequest[]): Send[] {
  const out: Send[] = [];
  for (const t of txs) {
    const signer = t.signerId?.trim().toLowerCase();
    if (!signer) continue;
    for (const a of t.actions) {
      if (a.type === "Transfer" && /^\d+$/.test(a.deposit) && BigInt(a.deposit) >= NEAR_DUST) {
        out.push({ signer, symbol: "NEAR", decimals: 24, human: rawToHuman(BigInt(a.deposit), 24) });
      } else if (ft(a) && (a.methodName === "ft_transfer" || a.methodName === "ft_transfer_call")) {
        const amt = argStr(a.args, "amount");
        if (!amt || !/^\d+$/.test(amt)) continue;
        const meta = tokenByContract(network, t.receiverId.toLowerCase());
        const decimals = meta?.decimals ?? -1;
        if (decimals < 0) continue;
        const human = rawToHuman(BigInt(amt), decimals);
        if (human < DUST_HUMAN) continue;
        out.push({ signer, contract: t.receiverId.toLowerCase(), symbol: meta?.symbol ?? "token", decimals, human });
      } else if (ft(a) && /^\d+$/.test(a.deposit) && BigInt(a.deposit) >= NEAR_DUST) {
        out.push({ signer, symbol: "NEAR", decimals: 24, human: rawToHuman(BigInt(a.deposit), 24) });
      }
    }
  }
  return out;
}

function recipientsOf(txs: TxRequest[]): string[] {
  const out: string[] = [];
  const add = (a?: string) => {
    const x = a?.trim().toLowerCase();
    if (x && !out.includes(x)) out.push(x);
  };
  for (const t of txs) {
    for (const a of t.actions) {
      if (a.type === "Transfer" && /^\d+$/.test(a.deposit) && BigInt(a.deposit) > 0n) add(t.receiverId);
      if (a.type === "DeleteAccount") add(a.beneficiaryId);
      if (!ft(a)) continue;
      if (a.methodName === "ft_transfer" || a.methodName === "ft_transfer_call" || a.methodName === "nft_transfer" || a.methodName === "nft_transfer_call") {
        add(argStr(a.args, "receiver_id"));
      }
    }
  }
  return out;
}

function samplesOf(moves: AccountMove[], signer: string, contract: string | undefined, decimals: number): number[] {
  const asset = contract ?? "NEAR";
  const out: number[] = [];
  for (const m of moves) {
    if (m.direction !== "out" || m.asset.toLowerCase() !== asset || m.counterparty === signer) continue;
    try {
      const n = rawToHuman(BigInt(m.amount), decimals);
      if (n >= DUST_HUMAN) out.push(n);
    } catch { /* skip */ }
  }
  return out;
}

/**
 * R19 on a decoded send, and R20 on accounts that would receive value.
 * A missing activity source stays quiet (the rule can't run). A lookup that throws is
 * COULD_NOT_CHECK, never a pass. No earlier sends is not called unusual.
 */
export async function amountAndCollectorFindings(
  network: Network,
  txs: TxRequest[],
  sources: Sources,
  ask: <T>(p: () => Promise<T>) => Promise<T>,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const sends = sendsOf(network, txs);
  const cache = new Map<string, Promise<AccountMove[] | null>>();
  const load = (account: string) => {
    let p = cache.get(account);
    if (!p) {
      p = (async () => {
        if (!sources.accountActivity) return null;
        return ask(() => sources.accountActivity!(network, account));
      })();
      cache.set(account, p);
    }
    return p;
  };

  const signers = [...new Set(sends.map((s) => s.signer))];
  for (const signer of signers) {
    const mine = sends.filter((s) => s.signer === signer);
    const needsActivity = mine.some((s) => s.contract) || !!sources.accountActivity;
    if (!needsActivity && !sources.recentTransfers) continue;
    let moves: AccountMove[] | null = null;
    let deposits: number[] | null = null;
    try {
      if (sources.accountActivity) moves = await load(signer);
      else if (mine.some((s) => !s.contract)) {
        const txsHist = await ask(() => sources.recentTransfers(network, signer));
        deposits = txsHist.filter((t) => t.signer === signer && t.receiver !== signer).map((t) => t.depositYocto);
      }
    } catch (e) {
      findings.push(f("R19", "COULD_NOT_CHECK", "AMOUNT_HISTORY_FAILED",
        "Couldn't check: whether this is more than you usually send",
        `Couldn't read your recent sends (${e instanceof Error ? e.message : String(e)}). This amount isn't called normal.`));
      continue;
    }
    if (moves == null && deposits == null) continue;
    const seen = new Set<string>();
    for (const s of mine) {
      const key = s.contract ?? "NEAR";
      if (seen.has(key)) continue;
      seen.add(key);
      const samples = moves
        ? samplesOf(moves, signer, s.contract, s.decimals)
        : (deposits ?? []).map((y) => y / 1e24).filter((n) => n >= DUST_HUMAN);
      if (s.contract && !moves) continue;
      if (judgeUnusual(s.human, samples) !== "unusual") continue;
      const sorted = [...samples].filter((n) => n >= DUST_HUMAN).sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
      findings.push(f("R19", "ATTENTION", "UNUSUAL_AMOUNT", "You have not sent this much before",
        `Your recent ${s.symbol} sends are around ${formatHuman(median)} ${s.symbol}. This one is ${formatHuman(s.human)} ${s.symbol}. Look again before you approve.`,
        { evidence: [
          { label: "This amount", value: `${formatHuman(s.human)} ${s.symbol}` },
          { label: "Usual", value: `around ${formatHuman(median)} ${s.symbol}` },
        ] }));
    }
  }

  const recipients = recipientsOf(txs).filter((a) => !wellKnown(network, a)).slice(0, 6);
  for (const to of recipients) {
    const known = knownExchangeFinding(network, to);
    if (known) { findings.push(known); continue; }
    if (!sources.accountActivity) continue;
    try {
      const moves = await load(to);
      if (!moves) continue;
      const hit = collectorFromMoves(network, to, moves);
      if (hit) findings.push(hit);
    } catch (e) {
      findings.push(f("R20", "COULD_NOT_CHECK", "COLLECTOR_UNKNOWN",
        `Couldn't check: whether ${to} collects and forwards funds`,
        `The public history lookup didn't answer (${e instanceof Error ? e.message : String(e)}). Gideon won't call that pattern absent.`));
    }
  }
  return findings;
}
