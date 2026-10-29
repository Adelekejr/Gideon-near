import type { Ctx } from "../context.js";
import type { RuleId } from "../types.js";
import type { RuleResult } from "./util.js";
import { r01Format } from "./r01-format.js";
import { r02PastedHash } from "./r02-pasted-hash.js";
import { r03AccountState } from "./r03-account-state.js";
import { r04EthImplicit } from "./r04-eth-implicit.js";
import { r05Token } from "./r05-token.js";
import { r06Intents } from "./r06-intents.js";
import { r07Lookalike } from "./r07-lookalike.js";
import { r08Exchange } from "./r08-exchange.js";
import { r09Clipboard } from "./r09-clipboard.js";
import { r10Registry } from "./r10-registry.js";
import { r11AccountAge } from "./r11-account-age.js";

export type Rule = { id: RuleId; name: string; run: (ctx: Ctx) => RuleResult | Promise<RuleResult> };

export const RULES: Rule[] = [
  { id: "R1", name: "Format and network", run: r01Format },
  { id: "R2", name: "Transaction hash pasted as an account", run: r02PastedHash },
  { id: "R3", name: "Account exists / new / contract", run: r03AccountState },
  { id: "R4", name: "Ethereum-style address on NEAR", run: r04EthImplicit },
  { id: "R5", name: "Token preflight", run: r05Token },
  { id: "R6", name: "NEAR Intents deposit address", run: r06Intents },
  { id: "R7", name: "Lookalike and address poisoning", run: r07Lookalike },
  { id: "R8", name: "Exchange credits this asset", run: r08Exchange },
  { id: "R9", name: "Clipboard changed", run: r09Clipboard },
  { id: "R10", name: "Community flag registry", run: r10Registry },
  { id: "R11", name: "Account age (brand-new accounts)", run: r11AccountAge },
];

/** When several rules block, the most specific explanation leads. */
export const HEADLINE_ORDER: RuleId[] = ["R9", "R2", "R6", "R7", "R8", "R5", "R1", "R3", "R4", "R11", "R10"];
