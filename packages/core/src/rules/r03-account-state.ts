import type { Ctx } from "../context.js";
import { explorerAccountUrl, NETWORKS } from "../networks.js";
import { yoctoToNear } from "../context.js";
import { couldNotCheck, f, skipped, type RuleResult } from "./util.js";
import { networkOfName } from "../classify.js";

const NO_CODE = "11111111111111111111111111111111";

/** R3 — does the account exist, is it new, is it a contract. */
export async function r03AccountState(ctx: Ctx): Promise<RuleResult> {
  const { c, input } = ctx;
  const net = input.network;
  if (c.kind !== "near-named" && c.kind !== "near-implicit" && c.kind !== "hex64-uppercase") return skipped("R3", "Not a NEAR named or implicit account.");
  if (c.kind === "near-named") {
    const home = networkOfName(c.normalized);
    if (home && home !== net) return skipped("R3", "Wrong network for this name; R1 already blocks it.");
  }
  const a = c.normalized;
  const r = await ctx.ask(`rpc-${net}`, `account:${a}`, (s) => s.viewAccount(net, a));
  if (!r.ok) return couldNotCheck("R3", "whether the account exists", r.error);
  const ev = [{ label: "Account", value: a, url: explorerAccountUrl(net, a) }];

  if (!r.value) {
    if (c.kind === "near-named") {
      return f("R3", "BLOCKED", "ACCOUNT_NOT_FOUND", `No account called ${a} on ${NETWORKS[net].label}`,
        "The send would fail. This is usually a typo, or the receiver gave you an account from a different network.",
        { fix: ["Copy the account name again from the receiver.", "Check you're on the same network as the receiver."], evidence: ev });
    }
    return f("R3", "ATTENTION", "IMPLICIT_UNFUNDED", "This account has never been used",
      "The format is valid, but this 64-character account has never received anything. Your send would create it, and only whoever holds its private key can ever move the funds.",
      { fix: ["Make sure the receiver really controls this account (it came from their own wallet).", "Send a small test amount first."], evidence: ev });
  }

  if (r.value.codeHash && r.value.codeHash !== NO_CODE && input.destination === "wallet") {
    return f("R3", "ATTENTION", "CONTRACT_ACCOUNT", "This account is a smart contract",
      "You said this is a person's wallet, but the account runs contract code. Sending plain NEAR to a contract can be hard to get back.",
      { fix: ["Check that you meant to pay a contract.", "If you wanted a person, ask for their own account."], evidence: ev });
  }
  return f("R3", "PASS", "ACCOUNT_EXISTS", "Account exists",
    `Holds ${yoctoToNear(r.value.amountYocto)} NEAR on ${NETWORKS[net].label}.`, { evidence: ev });
}
