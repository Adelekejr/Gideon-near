import type { Ctx } from "../context.js";
import { skipped, type RuleResult } from "./util.js";

/** R10 — community flag registry. The registry contract isn't deployed yet. */
export function r10Registry(_ctx: Ctx): RuleResult {
  return skipped("R10", "Community flag registry contract not deployed yet.");
}
