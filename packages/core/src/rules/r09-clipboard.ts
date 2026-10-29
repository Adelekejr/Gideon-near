import type { Ctx } from "../context.js";
import { f, skipped, type RuleResult } from "./util.js";

/** R9 — what you copied isn't what got pasted (clipboard hijacker). */
export function r09Clipboard(ctx: Ctx): RuleResult {
  const cb = ctx.input.clipboard;
  if (!cb) return skipped("R9", "No clipboard info (the browser extension provides it).");
  const copied = cb.copied.trim();
  const pasted = ctx.input.to.trim();
  if (copied === pasted) return f("R9", "PASS", "CLIPBOARD_MATCH", "Pasted what you copied", "The address in the field matches what you copied.");
  return f("R9", "BLOCKED", "CLIPBOARD_CHANGED", "The address changed after you copied it",
    "What you copied isn't what was pasted. Malware that swaps addresses on the clipboard does exactly this.",
    { fix: ["Don't send.", "Scan your device for malware, then copy the address again from the source."],
      evidence: [{ label: "Copied", value: copied }, { label: "Pasted", value: pasted }] });
}
