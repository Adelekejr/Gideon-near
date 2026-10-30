import type { Ctx } from "../context.js";
import { NETWORKS } from "../networks.js";
import { networkOfName } from "../classify.js";
import { historyAsk, senderHistory, senderOf } from "../history.js";
import { f, skipped, type RuleResult } from "./util.js";

const ACCOUNT_KINDS = ["near-named", "near-implicit", "eth-implicit", "hex64-uppercase"];

/**
 * R13 — first send to this address. When the sender is known, has it ever sent to this recipient?
 * A first send is where wrong and poisoned addresses do their damage, so it gets ATTENTION.
 * Info-only lookups: if the history can't be read in time the rule is left out, never blocking.
 */
export async function r13FirstSend(ctx: Ctx): Promise<RuleResult> {
  const { c, input } = ctx;
  if (!ACCOUNT_KINDS.includes(c.kind)) return skipped("R13", "Not a NEAR account.");
  const device = (input.deviceSends ?? []).map((a) => a.trim().toLowerCase());
  if (device.includes(c.normalized)) {
    return f("R13", "PASS", "SENT_BEFORE", "You've sent here before", `You sent to ${c.normalized} from this device before.`);
  }
  const from = senderOf(ctx);
  if (!from) return skipped("R13", input.from ? `Your account ${input.from} isn't on NEAR ${input.network}.` : "No sender account given.");
  const to = c.normalized;
  if (to === from) return skipped("R13", "Sending to your own account.");
  const saved = (input.addressBook ?? []).find((b) => b.account === to);
  if (saved) return f("R13", "PASS", "SAVED_CONTACT", "Saved contact", `${to} is in your address book.`);

  const net = input.network;
  const home = networkOfName(to);
  if (c.kind === "near-named" && home && home !== net) return skipped("R13", "The address is on the other network (see R1).");
  // Everything here shares one time budget, so this note can never hold up the verdict.
  const t0 = Date.now();
  const budget = ctx.limits.historyTimeoutMs ?? ctx.limits.sourceTimeoutMs;
  const [acc, hist] = await Promise.all([
    ctx.ask(`rpc-${net}`, `account:${to}`, (s) => s.viewAccount(net, to)), // shared with R3
    senderHistory(ctx),
  ]);
  if (!acc.ok || !acc.value) return skipped("R13", "No live account to compare with your history.");
  if (hist?.ok && hist.value.pastRecipients.includes(to)) {
    return f("R13", "PASS", "SENT_BEFORE", "You've sent here before", `Your recent history has a transaction from ${from} to ${to}.`);
  }
  const left = budget == null ? undefined : budget - (Date.now() - t0);
  if (left != null && left < 250) return skipped("R13", "Ran out of time to read your send history.");
  const r = await ctx.ask(`nearblocks-${net}`, `sent:${from}>${to}`, (s) => {
    if (!s.sentCount) throw new Error("no send-history source");
    return s.sentCount(net, from, to);
  }, { ...historyAsk(ctx), timeoutMs: left });
  if (!r.ok) return skipped("R13", `Couldn't read your send history in time (${r.error}).`);
  if (typeof r.value !== "number") return skipped("R13", "Your send history didn't say.");
  if (r.value > 0) {
    return f("R13", "PASS", "SENT_BEFORE", "You've sent here before",
      `${from} has sent ${r.value} transaction${r.value === 1 ? "" : "s"} to ${to}.`);
  }
  const token = input.asset.contract
    ? " Token transfers go through the token contract, so earlier token sends to this account aren't counted."
    : "";
  return f("R13", "ATTENTION", "FIRST_SEND", "You've never sent to this address before",
    `${from} has never sent a transaction to ${to} on ${NETWORKS[net].label}. First sends are where a wrong or poisoned address costs money: confirm it with the receiver another way, or send a small test amount first.${token}`,
    { fix: ["Confirm the address with the receiver another way (a call, or a chat you started).", "Send a small test amount first."],
      evidence: [{ label: "From", value: from }, { label: "To", value: to }] });
}
