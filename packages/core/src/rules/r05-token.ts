import type { Ctx } from "../context.js";
import { PROTECTED_SYMBOLS, tokenByContract, tokenBySymbol } from "../data.js";
import { explorerAccountUrl } from "../networks.js";
import { isNearAccountKind } from "../classify.js";
import { couldNotCheck, f, skipped, type RuleResult } from "./util.js";

/** R5 — token preflight: real token, not a fake, receiver registered. */
export async function r05Token(ctx: Ctx): Promise<RuleResult> {
  const { c, input } = ctx;
  const net = input.network;
  const contract = input.asset.contract;
  if (!contract) return skipped("R5", "Native NEAR, no token contract.");
  if (!isNearAccountKind(c.kind) && c.kind !== "hex64-uppercase") return skipped("R5", "Recipient isn't a NEAR account; R1 covers it.");

  const meta = await ctx.ask(`rpc-${net}`, `ft_metadata:${contract}`, (s) => s.ftMetadata(net, contract));
  if (!meta.ok) return couldNotCheck("R5", "the token contract", meta.error);
  const ev = [{ label: "Token contract", value: contract, url: explorerAccountUrl(net, contract) }];
  if (!meta.value) {
    return f("R5", "BLOCKED", "NOT_A_TOKEN", "That contract isn't a token",
      `${contract} doesn't answer ft_metadata on ${net}, so it isn't a NEP-141 token. A transfer would fail or go somewhere unexpected.`,
      { fix: ["Pick the token from your wallet's own list instead of pasting a contract."], evidence: ev });
  }

  const known = tokenByContract(net, contract);
  const sym = meta.value.symbol.toUpperCase().replace(/[^A-Z]/g, "");
  if (!known && PROTECTED_SYMBOLS.includes(sym)) {
    const real = tokenBySymbol(net, sym === "WNEAR" ? "wNEAR" : sym);
    return f("R5", "BLOCKED", "FAKE_TOKEN", `Fake ${meta.value.symbol}`,
      `This contract calls itself ${meta.value.symbol}, but it isn't the real one${real ? ` (${real.contract})` : ""}. Lookalike tokens are a common trick.`,
      { fix: ["Don't send or accept this token as payment.", real ? `The real ${real.symbol} is ${real.contract}.` : "Check the token in your wallet's verified list."], evidence: ev });
  }

  const findings = [];
  if (known?.kind === "bridged") {
    findings.push(f("R5", "PASS", "BRIDGED_TOKEN", `${known.symbol} is a bridged token`,
      `${known.symbol} is a legitimate bridged token, but it isn't the same as native ${known.symbol.replace(".e", "")}. Some receivers only accept the native one.`, { evidence: ev }));
  }

  const to = c.normalized;
  const reg = await ctx.ask(`rpc-${net}`, `storage:${contract}:${to}`, (s) => s.storageRegistered(net, contract, to));
  if (!reg.ok) findings.push(couldNotCheck("R5", "whether the receiver can hold this token", reg.error));
  else if (!reg.value) {
    findings.push(f("R5", "ATTENTION", "NOT_REGISTERED", `Receiver isn't registered for ${meta.value.symbol}`,
      `${to} has no storage on the ${meta.value.symbol} contract. Most wallets pay the small storage deposit for you; if yours doesn't, the transfer fails.`,
      { fix: ["Let your wallet add the storage deposit (about 0.00125 NEAR), or ask the receiver to register first."], evidence: ev }));
  } else if (!known || known.kind === "canonical") {
    findings.push(f("R5", "PASS", "TOKEN_OK", `${meta.value.symbol} token checks out`,
      `${known ? "Known" : "Real NEP-141"} token and the receiver is registered.`, { evidence: ev }));
  }
  return findings;
}
