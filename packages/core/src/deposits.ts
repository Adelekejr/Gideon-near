import { tokenByContract } from "./data.js";
import type { Finding, Network, OneClickStatus } from "./types.js";
import { f, short } from "./rules/util.js";

const CLOSED = new Set(["SUCCESS", "REFUNDED", "FAILED"]);

const CHAIN_NAMES: Record<string, string> = {
  near: "near", eth: "ethereum", ethereum: "ethereum", "1": "ethereum",
  sol: "solana", solana: "solana",
  arb: "arbitrum", arbitrum: "arbitrum",
  base: "base",
  btc: "bitcoin", bitcoin: "bitcoin",
  tron: "tron", trx: "tron",
  op: "optimism", optimism: "optimism",
  polygon: "polygon", matic: "polygon", "137": "polygon",
  bsc: "bsc", binance: "bsc", "56": "bsc",
  avax: "avalanche", avalanche: "avalanche",
};

/** A chain name Gideon can compare: "Solana", "sol", "137" → "solana" / "polygon". Unknown text is lowercased. */
export function canonicalChain(name: string): string {
  const x = name.trim().toLowerCase().replace(/[\s_-]+/g, "");
  return CHAIN_NAMES[x] ?? x;
}

/**
 * Chain implied by a 1Click asset id.
 * `nep141:wrap.near` is NEAR. `sol.omft.near` and `eth:0x…` name the other chain.
 * Null when the id doesn't say.
 */
export function chainOfAsset(id: string | undefined): string | null {
  if (!id) return null;
  const s = id.trim().toLowerCase();
  if (s === "near" || s === "native") return "near";
  const prefixed = /^(eth|ethereum|sol|solana|arb|arbitrum|base|btc|bitcoin|tron|trx|op|optimism|polygon|matic|bsc|avax|near):/.exec(s);
  if (prefixed) return canonicalChain(prefixed[1]);
  const nep245 = /^nep245:[^:]+:(\d+|[a-z0-9]+)_/.exec(s);
  if (nep245) return canonicalChain(nep245[1]);
  const body = s.replace(/^nep141:/, "").replace(/^nep245:/, "");
  const host = body.split(".")[0] ?? "";
  if (host && CHAIN_NAMES[host] && host !== "near") return CHAIN_NAMES[host];
  if (s.startsWith("nep141:") || body.endsWith(".near") || body.endsWith(".testnet") || body === "wrap.near") return "near";
  return null;
}

function assetLabel(id: string | undefined): string {
  if (!id) return "unknown";
  const contract = id.replace(/^nep141:/, "");
  const t = tokenByContract("mainnet", contract);
  return t ? `${t.symbol} (${contract})` : id;
}

function sameAsset(sent: string, origin: string): boolean {
  const a = sent.toLowerCase().replace(/^nep141:/, "");
  const b = origin.toLowerCase().replace(/^nep141:/, "");
  if ((a === "native" || a === "near") && (b === "native" || b === "near")) return true;
  return a === b;
}

export interface DepositJudge {
  address: string;
  network: Network;
  /** "native" or "nep141:<contract>". */
  sentAsset: string;
  symbol: string;
  /** Human amount, only when it uses the same units as the quote. */
  amount?: string;
  /** Chain the sender says this deposit pays out on. */
  bridgeChain?: string;
  /** Chain named in the transaction args. */
  argChain?: string;
  /** Token the transaction args say to send, when the quote doesn't. */
  argOrigin?: string;
  /** Deadline from the transaction args (ms), when the quote doesn't say. */
  argDeadlineMs?: number;
  now: number;
  status: OneClickStatus;
}

/**
 * Compare a known 1Click deposit with what is about to be sent.
 * Wrong chain, wrong token, a finished swap, or an expired quote is BLOCKED.
 * A payout chain that isn't in the quote, native NEAR where the quote wants wNEAR,
 * or a different amount is LOOK AGAIN. A clean quote passes.
 */
export function judgeDeposit(rule: "R6" | "T8", o: DepositJudge): Finding[] {
  const req = o.status.quoteResponse?.quoteRequest ?? {};
  const quote = o.status.quoteResponse?.quote ?? {};
  const origin = req.originAsset ?? o.argOrigin;
  const ev = [
    { label: "1Click deposit address", value: short(o.address) },
    { label: "Swap status", value: o.status.status },
    { label: "Expects", value: assetLabel(origin) },
  ];
  const out: Finding[] = [];

  if (o.network !== "mainnet") {
    out.push(f(rule, "BLOCKED", "MAINNET_DEPOSIT_ON_TESTNET", "This is a mainnet deposit address",
      "1Click deposit addresses only exist on NEAR mainnet. On testnet the same characters are a different, unrelated account.",
      { fix: ["Switch to mainnet if you meant to fund this swap."], evidence: ev }));
  }

  if (origin) {
    if (o.sentAsset === "native" && origin === "nep141:wrap.near") {
      out.push(f(rule, "ATTENTION", "NATIVE_FOR_WNEAR", "This deposit expects wNEAR",
        "The quote's input asset is wNEAR (wrap.near). Native NEAR may not be picked up by this deposit address.",
        { fix: ["Wrap NEAR to wNEAR first, or send from the swap app itself."], evidence: ev }));
    } else if (!sameAsset(o.sentAsset, origin)) {
      out.push(f(rule, "BLOCKED", "WRONG_ASSET_FOR_DEPOSIT", `This deposit address expects ${assetLabel(origin)}`,
        `You're sending ${o.symbol}, but this 1Click deposit address was made for ${assetLabel(origin)}. A different token won't be swapped.`,
        { fix: [`Send ${assetLabel(origin)} instead, or get a new quote for ${o.symbol}.`], evidence: ev }));
    }
  }
  if (req.originAsset && o.argOrigin && !sameAsset(req.originAsset, o.argOrigin) && !out.some((x) => x.code === "WRONG_ASSET_FOR_DEPOSIT")) {
    out.push(f(rule, "BLOCKED", "WRONG_ASSET_FOR_DEPOSIT", `This deposit address expects ${assetLabel(req.originAsset)}`,
      `The transaction names ${assetLabel(o.argOrigin)}, but the quote was made for ${assetLabel(req.originAsset)}.`,
      { fix: ["Use the token the quote asked for, or start a new quote."], evidence: ev }));
  }

  const dest = chainOfAsset(req.destinationAsset);
  const named = o.bridgeChain?.trim() || o.argChain?.trim();
  if (named) {
    const want = canonicalChain(named);
    if (!dest) {
      out.push(f(rule, "ATTENTION", "CHAIN_UNCONFIRMED", "Payout chain isn't confirmed",
        `This was described as paying out on ${want}, but the deposit quote doesn't say which chain that is. Gideon won't call that a match.`,
        { fix: ["Check the payout chain in the swap app before you send."], evidence: ev }));
    } else if (canonicalChain(dest) !== want) {
      out.push(f(rule, "BLOCKED", "WRONG_CHAIN_FOR_DEPOSIT", `This deposit pays out on ${canonicalChain(dest)}, not ${want}`,
        `You're treating this as a ${want} deposit, but the quote pays out on ${canonicalChain(dest)}. Funds would not arrive on ${want}.`,
        { fix: [`Get a new quote for ${want}, or send only if you meant ${canonicalChain(dest)}.`, "Check the chain in the swap app."],
          evidence: [...ev, { label: "Payout chain", value: canonicalChain(dest) }] }));
    }
  }

  if (CLOSED.has(o.status.status)) {
    out.push(f(rule, "BLOCKED", "DEPOSIT_ADDRESS_USED", `This swap already finished (${o.status.status})`,
      `1Click says this deposit address is done${o.status.updatedAt ? ` since ${o.status.updatedAt.slice(0, 10)}` : ""}. Deposit addresses are made for one swap; anything sent now isn't part of a live quote.`,
      { fix: ["Start a new swap and use its fresh deposit address."], evidence: ev }));
  } else {
    const deadline = quote.deadline ?? req.deadline;
    const quoteMs = deadline ? Date.parse(deadline) : NaN;
    if (deadline && quoteMs < o.now) {
      out.push(f(rule, "BLOCKED", "QUOTE_EXPIRED", "This quote has expired",
        `The deposit deadline was ${deadline}. A deposit now will be refunded at best.`,
        { fix: ["Get a new quote in the swap app."], evidence: ev }));
    } else if (o.argDeadlineMs != null && o.argDeadlineMs < o.now) {
      out.push(f(rule, "BLOCKED", "QUOTE_EXPIRED", "This quote has expired",
        "The transaction says this deposit's deadline has passed. A deposit now will be refunded at best.",
        { fix: ["Get a new quote in the swap app."], evidence: ev }));
    }
  }

  if (o.amount && quote.amountInFormatted && Number(o.amount) !== Number(quote.amountInFormatted) && req.swapType === "EXACT_INPUT") {
    out.push(f(rule, "ATTENTION", "AMOUNT_DIFFERS", "Amount differs from the quote",
      `The quote expects exactly ${quote.amountInFormatted}; you're sending ${o.amount}.`, { evidence: ev }));
  }

  if (!out.length) {
    out.push(f(rule, "PASS", "DEPOSIT_ADDRESS_OK", "Live NEAR Intents deposit address",
      `1Click status ${o.status.status}, expecting ${assetLabel(origin)}.`, { evidence: ev }));
  }
  return out;
}
