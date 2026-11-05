import type { Ctx } from "../context.js";
import { NETWORKS } from "../networks.js";
import { networkOfName } from "../classify.js";
import { historyAsk, senderHistory, senderOf } from "../history.js";
import { f, skipped, type RuleResult } from "./util.js";
import { VERDICT_TEXT } from "../text.js";

const ACCOUNT_KINDS = ["near-named", "near-implicit", "eth-implicit", "hex64-uppercase"];

/**
 * R13 — first send to this address. When the sender is known, has it ever sent to this recipient?
 * A first send is where wrong and poisoned addresses do their damage, so it gets ATTENTION.
 * A failed or timed-out history lookup is LOOK AGAIN with a Not checked line, never SAFE.
 * A build with no send-history source leaves the rule out (there is nothing to ask).
 */
export async function r13FirstSend(ctx: Ctx): Promise<RuleResult> {
  const { c, input } = ctx;
  if (!ACCOUNT_KINDS.includes(c.kind)) return skipped("R13", "Not a NEAR account.");
  const device = (input.deviceSends ?? []).map((a) => a.trim().toLowerCase());
  if (device.includes(c.normalized)) {
    return f("R13", "PASS", "SENT_BEFORE", "You've sent here before", `You sent to ${c.normalized} from this device before.`);
  }
  const from = senderOf(ctx);
  if (!from) {
    if (input.from) return skipped("R13", `Your account ${input.from} isn't on NEAR ${input.network}.`);
    // Not "not relevant": it couldn't run. Every surface shows this as a visible "Not checked" line.
    return f("R13", "SKIPPED", "SENDER_UNKNOWN", "Not checked: your send history", VERDICT_TEXT.senderUnknown.replace(/^Not checked: your send history\. /, ""));
  }
  const to = c.normalized;
  if (to === from) return skipped("R13", "Sending to your own account.");
  const saved = (input.addressBook ?? []).find((b) => b.account === to);
  if (saved) return f("R13", "PASS", "SAVED_CONTACT", "Saved contact", `${to} is in your address book.`);

  const net = input.network;
  const home = networkOfName(to);
  if (c.kind === "near-named" && home && home !== net) return skipped("R13", "The address is on the other network (see R1).");
  // Everything here shares one time budget, so a slow history can't hang the check. A failure still isn't SAFE.
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
  const unchecked = (why: string) => f("R13", "ATTENTION", "FIRST_SEND_UNKNOWN", "Not checked: whether you've sent here before", why);
  const left = budget == null ? undefined : budget - (Date.now() - t0);
  if (left != null && left < 250) return unchecked("Ran out of time to read your send history, so this isn't called a send you've made before.");
  const r = await ctx.ask(`nearblocks-${net}`, `sent:${from}>${to}`, (s) => {
    if (!s.sentCount) throw new Error("no send-history source");
    return s.sentCount(net, from, to);
  }, { ...historyAsk(ctx), timeoutMs: left });
  // A build with no send-history source can't invent a failure. A source that errors or times out is not safe.
  if (!r.ok && /no send-history source/i.test(r.error)) return skipped("R13", "No send-history source is configured.");
  if (!r.ok) return unchecked(`Couldn't read your send history (${r.error}). This isn't called a send you've made before.`);
  if (typeof r.value !== "number") return unchecked("Your send history didn't say whether you've sent here before, so this isn't called safe.");
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
