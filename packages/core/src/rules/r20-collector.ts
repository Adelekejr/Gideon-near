import type { Ctx } from "../context.js";
import { isNearAccountKind } from "../classify.js";
import { exchangeAccount, EXCHANGE_ACCOUNTS_CHECKED, EXCHANGE_ACCOUNTS_LIMIT } from "../exchange-accounts.js";
import { historyAsk } from "../history.js";
import { wellKnown } from "../known.js";
import { tokenByContract } from "../data.js";
import type { AccountMove, Finding, Network } from "../types.js";
import { f, skipped, type RuleResult } from "./util.js";

/** Distinct accounts that sent something here. */
export const COLLECTOR_MIN_SENDERS = 5;
/** Distinct assets coming in. */
export const COLLECTOR_MIN_ASSETS = 3;
/** Inflows that were followed by an outflow within the window. */
export const COLLECTOR_MIN_FORWARDS = 3;
/** "Quickly": funds leave within this long of arriving. */
export const FORWARD_WINDOW_MS = 30 * 60_000;

const CORE = new Set(["NEAR", "WNEAR", "USDT", "USDC"]);

function symbolOf(network: Network, asset: string): string {
  if (asset === "NEAR") return "NEAR";
  if (asset === "wrap.near" || asset === "wrap.testnet") return "wNEAR";
  const t = tokenByContract(network, asset);
  if (t) return t.symbol.replace(/\.e$/i, "");
  if (asset.includes("usdt")) return "USDT";
  if (asset.includes("usdc")) return "USDC";
  return asset.length > 18 ? `${asset.slice(0, 8)}…` : asset;
}

export function knownExchangeFinding(network: Network, account: string): Finding | null {
  const ex = exchangeAccount(network, account);
  if (!ex) return null;
  const role = ex.role === "cold" ? "cold wallet" : ex.role === "deposit" ? "deposit wallet" : "hot wallet";
  return f("R20", "PASS", "KNOWN_EXCHANGE", `Known exchange: ${ex.name}`,
    `This is a ${ex.name} ${role}. Gideon does not treat it as a drainer. ${EXCHANGE_ACCOUNTS_LIMIT}`,
    { evidence: [
      { label: "Account", value: ex.account, url: ex.source },
      { label: "List checked", value: EXCHANGE_ACCOUNTS_CHECKED },
    ] });
}

/**
 * Collector shape: many different senders, a mix of tokens, and funds forwarded quickly.
 * LOOK AGAIN, never BLOCKED. Exchanges and busy apps can look the same; a known exchange is not this.
 */
export function collectorFromMoves(network: Network, account: string, moves: AccountMove[]): Finding | null {
  const known = knownExchangeFinding(network, account);
  if (known) return known;
  const ins = moves.filter((m) => m.direction === "in" && m.counterparty !== account);
  const senders = new Set(ins.map((m) => m.counterparty));
  const assets = new Set(ins.map((m) => m.asset.toLowerCase()));
  const symbols = new Set([...assets].map((a) => symbolOf(network, a).toUpperCase().replace(/[^A-Z]/g, "")));
  const core = [...symbols].filter((s) => CORE.has(s));
  let forwards = 0;
  for (const inn of ins) {
    if (!inn.atMs) continue;
    const left = moves.some((m) => m.direction === "out" && m.atMs >= inn.atMs && m.atMs - inn.atMs <= FORWARD_WINDOW_MS);
    if (left) forwards++;
  }
  if (senders.size < COLLECTOR_MIN_SENDERS || assets.size < COLLECTOR_MIN_ASSETS || core.length < 2 || forwards < COLLECTOR_MIN_FORWARDS) {
    return null;
  }
  const mix = [...symbols].slice(0, 6).join(", ");
  return f("R20", "ATTENTION", "COLLECTOR_PATTERN", "Look again: this address takes in many tokens and sends them on quickly",
    `${senders.size} different accounts recently sent it a mix of tokens (${mix}), and funds were forwarded within minutes. Wallet drainers collect money this way. Exchanges and busy apps can look the same, and this address is not on Gideon's exchange list, so this is not a block.`,
    { evidence: [
      { label: "Senders", value: String(senders.size) },
      { label: "Tokens", value: mix },
      { label: "Forwarded", value: `${forwards} inflows followed by an outflow within 30 minutes` },
    ] });
}

/**
 * R20 — drainer-like public history, plus the exchange allowlist.
 * A known exchange is named and is not treated as a drainer.
 * No activity source: the rule is left out (it does not pretend the pattern is absent).
 * A failed lookup is COULD_NOT_CHECK, never a pass.
 */
export async function r20Collector(ctx: Ctx): Promise<RuleResult> {
  const { c, input } = ctx;
  if (!isNearAccountKind(c.kind) && c.kind !== "hex64-uppercase") return skipped("R20", "Not a NEAR account.");
  const to = c.normalized;
  if (input.from && input.from.trim().toLowerCase() === to) return skipped("R20", "This is your own account.");
  if (wellKnown(input.network, to)) return skipped("R20", "A well-known contract, not checked as a collector.");
  const known = knownExchangeFinding(input.network, to);
  if (known) return known;
  if (!ctx.can("accountActivity")) return skipped("R20", "No public-activity source is configured.");
  const act = await ctx.ask(`activity-${input.network}`, `activity:${to}`, (s) => s.accountActivity!(input.network, to), historyAsk(ctx));
  if (!act.ok) {
    return f("R20", "COULD_NOT_CHECK", "COLLECTOR_UNKNOWN", "Couldn't check: whether this address collects and forwards funds",
      `The public history lookup didn't answer (${act.error}). Gideon won't call that pattern absent.`);
  }
  return collectorFromMoves(input.network, to, act.value)
    ?? f("R20", "PASS", "NO_COLLECTOR_PATTERN", "No collector pattern in recent public history",
      "Gideon didn't see many different accounts sending a mix of tokens that were forwarded quickly. That doesn't vouch for the address.");
}
