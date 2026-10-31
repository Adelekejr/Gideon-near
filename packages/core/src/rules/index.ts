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
import { r13FirstSend } from "./r13-first-send.js";
import { r14ReportedScam } from "./r14-reported-scam.js";
import { r15FakeLetters } from "./r15-fake-letters.js";
import { r16OtherNetworkTwin } from "./r16-other-network.js";
import { r17DisguisedName } from "./r17-disguised-name.js";

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
  { id: "R13", name: "First send to this address", run: r13FirstSend },
  { id: "R14", name: "Reported scam", run: r14ReportedScam },
  { id: "R15", name: "Fake letters and hidden characters", run: r15FakeLetters },
  { id: "R16", name: "Same name on the other network", run: r16OtherNetworkTwin },
  { id: "R17", name: "NEAR name disguised as another chain's address", run: r17DisguisedName },
];

/** When several rules block (R18, the drained-wallet check, runs after the main check: see drainer.ts), the most specific explanation leads. */
export const HEADLINE_ORDER: RuleId[] = ["T1", "T6", "T5", "T2", "T3", "T4", "R14", "R18", "R15", "R17", "R9", "R2", "R6", "R7", "R8", "R5", "R16", "R1", "R3", "R4", "R11", "R13", "R10"];
