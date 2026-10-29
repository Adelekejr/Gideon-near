import type { Ctx } from "../context.js";
import { EXCHANGES_CHECKED, findExchange } from "../data.js";
import { f, skipped, type RuleResult } from "./util.js";

/** R8 — will the exchange credit this asset? Never BLOCKED from registry data alone. */
export function r08Exchange(ctx: Ctx): RuleResult {
  const { input } = ctx;
  if (input.destination !== "exchange") return skipped("R8", "Not sending to an exchange.");
  const ex = findExchange(input.network, input.exchange);
  const sym = input.asset.symbol;
  const ev = [
    { label: "Registry entry", value: `${ex.name}${ex.verified ? "" : " (starter data, unconfirmed)"}`, ...(ex.source ? { url: ex.source } : {}) },
    { label: "Checked", value: EXCHANGES_CHECKED },
  ];
  if (ex.credits.includes(sym)) {
    return f("R8", "PASS", "EXCHANGE_CREDITS", `${ex.name} credits ${sym}`,
      `${ex.note}${ex.memo === "unknown" ? " Check the deposit page for a memo or tag." : ""}`, { evidence: ev });
  }
  const fix = sym === "wNEAR"
    ? ["Unwrap wNEAR to native NEAR in your wallet first (it's one click and costs almost nothing).", "Then send native NEAR to the exchange."]
    : [`Check ${ex.name}'s deposit page lists ${sym} on the NEAR network before sending.`, "If it doesn't, swap to native NEAR first."];
  return f("R8", "ATTENTION", "EXCHANGE_MAY_NOT_CREDIT", `${ex.name} may not credit ${sym}`,
    `Exchanges usually credit only the tokens they list for the NEAR network. ${sym} sent to a NEAR deposit address that doesn't support it can sit uncredited. ${ex.note}`,
    { fix, evidence: ev });
}
