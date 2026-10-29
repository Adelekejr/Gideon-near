import type { Ctx } from "../context.js";
import { tokenByContract } from "../data.js";
import { explorerAccountUrl } from "../networks.js";
import { couldNotCheck, f, skipped, short, type RuleResult } from "./util.js";
import type { Finding } from "../types.js";

const CLOSED = new Set(["SUCCESS", "REFUNDED", "FAILED"]);

function assetLabel(id: string | undefined): string {
  if (!id) return "unknown";
  const contract = id.replace(/^nep141:/, "");
  const t = tokenByContract("mainnet", contract);
  return t ? `${t.symbol} (${contract})` : id;
}

/**
 * R6 — NEAR Intents 1Click deposit address. Read-only: only GET /v0/status.
 * 1Click runs on mainnet only.
 */
export async function r06Intents(ctx: Ctx): Promise<RuleResult> {
  const { c, input } = ctx;
  const wantsIntents = input.destination === "intents";
  if (c.kind !== "near-implicit" && c.kind !== "hex64-uppercase") {
    if (wantsIntents) {
      return f("R6", "ATTENTION", "NOT_A_DEPOSIT_FORMAT", "Not a 1Click deposit address",
        "NEAR Intents 1Click deposit addresses on NEAR are 64-character accounts. This isn't one.",
        { fix: ["Copy the deposit address again from the swap app."] });
    }
    return skipped("R6", "Not a 64-character account, so not a 1Click deposit address.");
  }

  const addr = c.normalized;
  const r = await ctx.ask("1click", addr, (s) => s.oneClickStatus(addr));
  if (!r.ok) return couldNotCheck("R6", "whether this is a NEAR Intents deposit address", r.error);
  if (!r.value) {
    if (wantsIntents) {
      return f("R6", "ATTENTION", "UNKNOWN_DEPOSIT_ADDRESS", "1Click doesn't know this deposit address",
        "You said this is a NEAR Intents deposit, but 1Click has no swap for this address.",
        { fix: ["Copy the deposit address again from the swap app, or start a new quote."] });
    }
    return f("R6", "SKIPPED", "NOT_A_DEPOSIT_ADDRESS", "Not a NEAR Intents deposit address", "1Click has no swap for this address.");
  }

  const st = r.value;
  const req = st.quoteResponse?.quoteRequest ?? {};
  const quote = st.quoteResponse?.quote ?? {};
  const expected = req.originAsset;
  const ev = [{ label: "1Click deposit address", value: short(addr), url: explorerAccountUrl("mainnet", addr) },
    { label: "Swap status", value: st.status }, { label: "Expects", value: assetLabel(expected) }];
  const out: Finding[] = [];

  if (input.network !== "mainnet") {
    out.push(f("R6", "BLOCKED", "MAINNET_DEPOSIT_ON_TESTNET", "This is a mainnet deposit address",
      "1Click deposit addresses only exist on NEAR mainnet. On testnet the same characters are a different, unrelated account.",
      { fix: ["Switch to mainnet if you meant to fund this swap."], evidence: ev }));
  }

  const sent = input.asset.contract ? `nep141:${input.asset.contract}` : "native";
  if (expected) {
    if (sent === "native" && expected === "nep141:wrap.near") {
      out.push(f("R6", "ATTENTION", "NATIVE_FOR_WNEAR", "This deposit expects wNEAR",
        "The quote's input asset is wNEAR (wrap.near). Native NEAR may not be picked up by this deposit address.",
        { fix: ["Wrap NEAR to wNEAR first, or send from the swap app itself."], evidence: ev }));
    } else if (sent !== expected) {
      out.push(f("R6", "BLOCKED", "WRONG_ASSET_FOR_DEPOSIT", `This deposit address expects ${assetLabel(expected)}`,
        `You're sending ${input.asset.symbol}, but this 1Click deposit address was made for ${assetLabel(expected)}. A different token won't be swapped.`,
        { fix: [`Send ${assetLabel(expected)} instead, or get a new quote for ${input.asset.symbol}.`], evidence: ev }));
    }
  }

  if (CLOSED.has(st.status)) {
    out.push(f("R6", "BLOCKED", "DEPOSIT_ADDRESS_USED", `This swap already finished (${st.status})`,
      `1Click says this deposit address is done${st.updatedAt ? ` since ${st.updatedAt.slice(0, 10)}` : ""}. Deposit addresses are made for one swap; anything sent now isn't part of a live quote.`,
      { fix: ["Start a new swap and use its fresh deposit address."], evidence: ev }));
  } else {
    const deadline = quote.deadline ?? req.deadline;
    if (deadline && Date.parse(deadline) < ctx.now) {
      out.push(f("R6", "BLOCKED", "QUOTE_EXPIRED", "This quote has expired",
        `The deposit deadline was ${deadline}. A deposit now will be refunded at best.`,
        { fix: ["Get a new quote in the swap app."], evidence: ev }));
    }
  }

  if (input.amount && quote.amountInFormatted && Number(input.amount) !== Number(quote.amountInFormatted) && req.swapType === "EXACT_INPUT") {
    out.push(f("R6", "ATTENTION", "AMOUNT_DIFFERS", "Amount differs from the quote",
      `The quote expects exactly ${quote.amountInFormatted}; you're sending ${input.amount}.`, { evidence: ev }));
  }

  if (!out.length) {
    out.push(f("R6", "PASS", "DEPOSIT_ADDRESS_OK", "Live NEAR Intents deposit address",
      `1Click status ${st.status}, expecting ${assetLabel(expected)}.`, { evidence: ev }));
  }
  return out;
}
