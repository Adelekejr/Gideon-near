import { classify } from "./classify.js";
import { makeCtx } from "./context.js";
import { NETWORKS } from "./networks.js";
import { makeReceipt } from "./receipt.js";
import { HEADLINE_ORDER, RULES } from "./rules/index.js";
import type { CheckInput, CheckOptions, CheckResult, Finding, Sources, Verdict } from "./types.js";

/** Findings that prove, from a live lookup, that the recipient account exists. SAFE needs one. */
const EXISTS_CODES = new Set(["ACCOUNT_EXISTS", "ETH_IMPLICIT_EXISTS"]);

export const ENGINE_VERSION = "gideon-core/0.1.0";

/** Any BLOCKED → BLOCKED. Otherwise anything ATTENTION or COULD_NOT_CHECK → ATTENTION. Only then SAFE. */
export function verdictOf(findings: Finding[]): Verdict {
  if (findings.some((x) => x.status === "BLOCKED")) return "BLOCKED";
  if (findings.some((x) => x.status === "ATTENTION" || x.status === "COULD_NOT_CHECK")) return "ATTENTION";
  return "SAFE";
}

export function headlineOf(findings: Finding[], verdict: Verdict): Finding | null {
  const order = (x: Finding) => HEADLINE_ORDER.indexOf(x.rule);
  const pick = (statuses: Finding["status"][]) =>
    findings.filter((x) => statuses.includes(x.status)).sort((a, b) => order(a) - order(b))[0] ?? null;
  if (verdict === "BLOCKED") return pick(["BLOCKED"]);
  if (verdict === "ATTENTION") return pick(["ATTENTION"]) ?? pick(["COULD_NOT_CHECK"]);
  return null;
}

/**
 * Check a send before it happens. The engine itself makes no network calls:
 * every fact comes from `sources` (live adapters, or recorded fixtures in tests).
 */
export async function check(rawInput: CheckInput, sources: Sources, opts: CheckOptions = {}): Promise<CheckResult> {
  const t0 = Date.now();
  const now = opts.now ?? Date.now();
  const input = {
    ...rawInput,
    to: rawInput.to ?? "",
    asset: rawInput.asset ?? { symbol: "NEAR" },
    destination: rawInput.destination ?? "unknown",
  };
  const c = classify(input.to);
  const registry = opts.flagRegistry !== undefined ? opts.flagRegistry || null : NETWORKS[input.network]?.flagRegistry ?? null;
  const ctx = makeCtx(input, c, sources, now, registry);

  const settled = await Promise.all(RULES.map(async (r) => {
    try {
      const out = await r.run(ctx);
      return out == null ? [] : Array.isArray(out) ? out : [out];
    } catch (e) {
      // A bug in a rule must never turn into "safe".
      const msg = e instanceof Error ? e.message : String(e);
      return [{ rule: r.id, code: "RULE_ERROR", status: "COULD_NOT_CHECK", title: `Couldn't check: ${r.name}`, detail: `Internal error: ${msg}` } as Finding];
    }
  }));
  const findings = settled.flat();
  const account = await ctx.accountFacts().catch(() => null);
  // Last line of defence: nothing is SAFE unless a live lookup found the account.
  if (verdictOf(findings) === "SAFE" && !(account?.exists === true && findings.some((x) => x.status === "PASS" && EXISTS_CODES.has(x.code)))) {
    findings.push({ rule: "R3", code: "EXISTENCE_UNCONFIRMED", status: "COULD_NOT_CHECK", title: "Couldn't confirm the account exists",
      detail: "Gideon only calls a send safe after a live lookup finds the receiving account. That lookup didn't confirm it, so check the address another way." });
  }
  const verdict = verdictOf(findings);
  const base = {
    engine: ENGINE_VERSION,
    input,
    classification: c,
    verdict,
    headline: headlineOf(findings, verdict),
    findings,
    account,
    sources: ctx.calls.sort((a, b) => a.source.localeCompare(b.source)),
    checkedAt: new Date(now).toISOString(),
    ms: Date.now() - t0,
  };
  return { ...base, receipt: await makeReceipt(base, opts.receiptKey) };
}
