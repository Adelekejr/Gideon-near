import type { Ctx } from "../context.js";
import { NETWORKS, explorerAccountUrl } from "../networks.js";
import { couldNotCheck, f, short, skipped, type RuleResult } from "./util.js";

const NEAR_KINDS = ["near-named", "near-implicit", "eth-implicit", "hex64-uppercase"];

/**
 * R10 — community flag registry (contracts/flag-registry). A free, keyless
 * `get_flags` view call. Anyone can add a flag, so flags only ever raise
 * ATTENTION, never BLOCKED. A missing contract is "couldn't check", never a pass.
 */
export async function r10Registry(ctx: Ctx): Promise<RuleResult> {
  const { c, input, registry } = ctx;
  const net = NETWORKS[input.network];
  if (!registry) return skipped("R10", `No community flag registry is configured for ${net.label}.`);
  if (!NEAR_KINDS.includes(c.kind)) return skipped("R10", "Not a NEAR account.");
  const to = c.normalized;

  const r = await ctx.ask(`registry-${input.network}`, `flags:${to}`, (s) => s.communityFlags(input.network, registry, to));
  if (!r.ok) return couldNotCheck("R10", "community flags", r.error);
  const regEv = { label: "Registry", value: registry, url: explorerAccountUrl(input.network, registry) };
  if (r.value === null) {
    return f("R10", "COULD_NOT_CHECK", "REGISTRY_MISSING", "Couldn't check: community flag registry is missing",
      `The flag registry ${registry} isn't deployed on ${net.label}, so Gideon couldn't see whether anyone flagged this account.`,
      { evidence: [{ label: "Registry", value: registry }] });
  }
  const flags = r.value;
  if (!flags.length) {
    return f("R10", "PASS", "NO_FLAGS", "Nobody has flagged this account", `Checked the community flag registry ${registry}.`, { evidence: [regEv] });
  }
  const n = flags.length;
  return f("R10", "ATTENTION", "COMMUNITY_FLAGGED", `Flagged by ${n} ${n === 1 ? "person" : "people"}`,
    `${n === 1 ? "Someone has" : `${n} people have`} reported ${to} as a scam or poisoning address. Anyone can add a flag, so it isn't proof, but look again before you send.`,
    { fix: ["Confirm the receiver with the person you're paying, another way than the chat where you got the address."],
      evidence: [...flags.slice(0, 3).map((x) => ({ label: short(x.reporter, 14, 6), value: x.reason })), regEv] });
}
