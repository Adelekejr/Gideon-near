import type { Ctx } from "../context.js";
import { explorerAccountUrl, NETWORKS } from "../networks.js";
import { couldNotCheck, f, skipped, type RuleResult } from "./util.js";
import { networkOfName } from "../classify.js";
import { editDistance, lookalike } from "../similarity.js";

/**
 * Accounts you might have meant: saved contacts and (when a sender is given) recent
 * counterparties within a small edit distance. History reuses R7's memoized call.
 */
async function closeMatches(ctx: Ctx, to: string): Promise<string[]> {
  const { input } = ctx;
  const pool = new Set((input.addressBook ?? []).map((b) => b.account));
  if (input.from) {
    const from = input.from;
    const h = await ctx.ask(`nearblocks-${input.network}`, `history:${from}`, (s) => s.recentTransfers(input.network, from));
    if (h.ok) for (const t of h.value) for (const a of [t.signer, t.receiver]) if (a && a !== from) pool.add(a);
  }
  pool.delete(to);
  const max = to.length < 10 ? 2 : 3;
  return [...pool]
    .map((a) => ({ a, d: editDistance(to, a) }))
    .filter((x) => x.d <= max || lookalike(to, x.a))
    .sort((x, y) => x.d - y.d)
    .slice(0, 3)
    .map((x) => x.a);
}

/** R3 — does the account exist (live view_account), is it new, is it a contract. */
export async function r03AccountState(ctx: Ctx): Promise<RuleResult> {
  const { c, input } = ctx;
  const net = input.network;
  if (c.kind !== "near-named" && c.kind !== "near-implicit" && c.kind !== "hex64-uppercase") return skipped("R3", "Not a NEAR named or implicit account.");
  if (c.kind === "near-named") {
    const home = networkOfName(c.normalized);
    if (home && home !== net) return skipped("R3", "Wrong network for this name; R1 already blocks it.");
  }
  const a = c.normalized;
  const where = NETWORKS[net].label;
  const r = await ctx.ask(`rpc-${net}`, `account:${a}`, (s) => s.viewAccount(net, a));
  if (!r.ok) return couldNotCheck("R3", "whether the account exists", r.error);
  const facts = await ctx.accountFacts();
  const ev = [{ label: "Account", value: a, url: explorerAccountUrl(net, a) }];

  if (!r.value) {
    if (c.kind === "near-named") {
      const near = await closeMatches(ctx, a);
      return f("R3", "BLOCKED", "ACCOUNT_NOT_FOUND", `This account doesn't exist on ${where}`,
        `There is no account called ${a} on ${where}. Anything sent there will fail or be lost. This is usually a typo, or an account from a different network.`,
        { fix: [
            "Check the spelling letter by letter with the receiver, then paste it again.",
            ...near.map((m) => `Did you mean ${m}? It's ${(input.addressBook ?? []).some((b) => b.account === m) ? "in your address book" : "in your recent history"}.`),
            "Check you're on the same network as the receiver.",
          ],
          evidence: [...ev, ...near.map((m) => ({ label: "Close match", value: m, url: explorerAccountUrl(net, m) }))] });
    }
    return f("R3", "ATTENTION", "IMPLICIT_UNFUNDED", "This account has never been used",
      "The format is valid, but this 64-character account has never received anything. Sending creates it, and only whoever holds its private key can ever move the funds. That's only OK if the owner gave it to you from their own wallet.",
      { fix: ["Make sure the receiver really controls this account (it came from their own wallet).", "Send a small test amount first."], evidence: ev });
  }

  const extra = [
    { label: "Created", value: facts?.createdAt ? facts.createdAt.slice(0, 10) : facts?.chainAgeDays === 0 ? "within the last 24 hours" : facts?.chainAgeDays != null && facts.chainAgeDays < 7 ? `${facts.chainAgeDays} day(s) ago` : facts?.chainAgeDays != null ? "more than 7 days ago" : facts?.created === "after-indexer" ? "recently (newer than our indexer's data)" : "date unavailable" },
    { label: "Balance", value: `${facts?.balanceNear ?? "?"} NEAR` },
  ];
  if (facts?.contract && input.destination === "wallet") {
    return f("R3", "ATTENTION", "CONTRACT_ACCOUNT", "This account is a smart contract",
      "You said this is a person's wallet, but the account runs contract code. Sending plain NEAR to a contract can be hard to get back.",
      { fix: ["Check that you meant to pay a contract.", "If you wanted a person, ask for their own account."], evidence: [...ev, ...extra] });
  }
  return f("R3", "PASS", "ACCOUNT_EXISTS", `Account exists on ${where}`,
    facts?.summary ?? `Account exists on ${where}.`, { evidence: [...ev, ...extra] });
}
