import { formatUnits } from "../amounts.js";
import { tokenByContract } from "../data.js";
import type { Network } from "../types.js";
import { swapLegs } from "./min-out.js";
import type { TxAction, TxRequest } from "./decode.js";

const NEAR = 10n ** 24n;
const DUST = NEAR / 100n; // 0.01 NEAR

function ft(a: TxAction): a is Extract<TxAction, { type: "FunctionCall" }> {
  return a.type === "FunctionCall";
}

function argStr(args: unknown, k: string): string | undefined {
  const v = (args as Record<string, unknown> | null)?.[k];
  return typeof v === "string" || typeof v === "number" ? String(v).trim() : undefined;
}

function decimalsOf(network: Network, contract: string | undefined): number | null {
  if (!contract) return 24;
  const id = contract.replace(/^nep141:/, "").toLowerCase();
  if (id === "near" || id === "wrap.near" || id === "wrap.testnet") return 24;
  return tokenByContract(network, id)?.decimals ?? null;
}

function symbolOf(network: Network, contract: string | undefined, fallback: string): string {
  if (!contract) return "NEAR";
  const id = contract.replace(/^nep141:/, "").toLowerCase();
  if (id === "near") return "NEAR";
  return tokenByContract(network, id)?.symbol ?? fallback;
}

function amountText(raw: string, decimals: number | null, symbol: string): string | null {
  if (!/^\d+$/.test(raw)) return null;
  if (decimals == null) return `${raw} units of ${symbol}`;
  return `${formatUnits(BigInt(raw), decimals)} ${symbol}`;
}

/**
 * Plain "you send / you receive / you approve" lines for a request whose args Gideon can read.
 * Empty when nothing in the request says that. Not a verdict.
 */
export function txPreview(network: Network, txs: TxRequest[]): string[] {
  const lines: string[] = [];
  const add = (s: string) => { if (s && !lines.includes(s)) lines.push(s); };
  for (const t of txs) {
    for (const a of t.actions) {
      if (a.type === "Transfer" && /^\d+$/.test(a.deposit) && BigInt(a.deposit) >= DUST) {
        add(`You send ${formatUnits(BigInt(a.deposit), 24)} NEAR to ${t.receiverId}.`);
      } else if (a.type === "AddKey" && a.fullAccess) {
        add(`You approve full access to ${t.receiverId}.`);
      } else if (a.type === "AddKey" && a.receiverId) {
        add(`You approve a key that can call ${a.receiverId}.`);
      } else if (a.type === "DeleteAccount") {
        add(`You send everything in ${t.receiverId} to ${a.beneficiaryId}.`);
      } else if (ft(a) && (a.methodName === "ft_transfer" || a.methodName === "ft_transfer_call")) {
        const to = argStr(a.args, "receiver_id");
        const amt = argStr(a.args, "amount");
        if (to && amt) {
          const text = amountText(amt, decimalsOf(network, t.receiverId), symbolOf(network, t.receiverId, t.receiverId));
          if (text) add(`You send ${text} to ${to}.`);
        }
      } else if (ft(a) && (a.methodName === "nft_approve" || a.methodName === "nft_transfer" || a.methodName === "nft_transfer_call")) {
        const who = argStr(a.args, a.methodName === "nft_approve" ? "account_id" : "receiver_id");
        const id = argStr(a.args, "token_id");
        if (who && a.methodName === "nft_approve") add(`You approve ${who} to move an NFT${id ? ` (${id})` : ""}.`);
        else if (who) add(`You send an NFT${id ? ` (${id})` : ""} to ${who}.`);
      } else if (ft(a) && /^\d+$/.test(a.deposit) && BigInt(a.deposit) >= DUST) {
        add(`You send ${formatUnits(BigInt(a.deposit), 24)} NEAR to ${t.receiverId}.`);
      }
    }
  }
  for (const leg of swapLegs(txs)) {
    if (leg.unreadable) continue;
    if (leg.amountIn > 0n) {
      const dIn = decimalsOf(network, leg.tokenIn);
      const sym = symbolOf(network, leg.tokenIn, "in");
      const text = dIn == null ? `${leg.amountIn.toString()} units of ${sym}` : `${formatUnits(leg.amountIn, dIn)} ${sym}`;
      add(`You send ${text}.`);
    }
    if (leg.minOut > 0n) {
      const dOut = decimalsOf(network, leg.tokenOut);
      const sym = symbolOf(network, leg.tokenOut, "out");
      const text = dOut == null ? `${leg.minOut.toString()} units of ${sym}` : `${formatUnits(leg.minOut, dOut)} ${sym}`;
      add(`You receive at least ${text}.`);
    }
  }
  return lines;
}
