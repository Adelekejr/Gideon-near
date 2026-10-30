import type { Ctx } from "../context.js";
import { lookalike } from "../similarity.js";
import { yoctoToNear } from "../context.js";
import { explorerTxUrl } from "../networks.js";
import { f, skipped, short, type RuleResult } from "./util.js";
import { senderHistory } from "../history.js";
import type { Evidence, Transfer } from "../types.js";

/** Native NEAR at or below this is "dust" (0.01 NEAR). */
const DUST_YOCTO = 1e22;

/**
 * R7 — lookalike of a saved contact or of someone you've sent to (BLOCKED), of a recent dust sender
 * (address poisoning, BLOCKED), or of another account in your history (ATTENTION).
 */
export async function r07Lookalike(ctx: Ctx): Promise<RuleResult> {
  const { c, input } = ctx;
  if (!["near-named", "near-implicit", "eth-implicit", "hex64-uppercase"].includes(c.kind)) return skipped("R7", "Not a NEAR account.");
  const to = c.normalized;
  const book = input.addressBook ?? [];

  const saved = book.find((b) => b.account === to);
  if (saved) return f("R7", "PASS", "SAVED_CONTACT", `Saved contact${saved.label ? `: ${saved.label}` : ""}`, "Exact match with your address book.");

  /** The live lookup is shared with R3, so this costs no extra call. */
  const missing = async () => ((await ctx.accountFacts())?.exists === false ? ` And ${to} doesn't exist on NEAR ${input.network}, so anything sent there would fail or be lost.` : "");
  for (const b of book) {
    const m = lookalike(to, b.account);
    if (m) {
      return f("R7", "BLOCKED", "LOOKALIKE_OF_CONTACT", `Looks like ${b.label ?? b.account}, but it isn't`,
        `You pasted ${to}. Your saved contact is ${b.account}. ${m.reason}, which is how address-poisoning and typo scams work.${await missing()}`,
        { fix: [`Send to your saved contact ${b.account} instead.`, "If the receiver really changed accounts, confirm it with them another way."],
          evidence: [{ label: "You pasted", value: to }, { label: "Saved contact", value: b.account }] });
    }
  }

  // Sends made from this device: known even when the wallet's account can't be read or the indexer lags.
  const device = [...new Set((input.deviceSends ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean))];
  if (!device.includes(to)) {
    for (const cp of device) {
      const m = lookalike(to, cp);
      if (!m) continue;
      return f("R7", "BLOCKED", "LOOKALIKE_OF_PAST_RECIPIENT", `Looks like ${cp.length <= 40 ? cp : short(cp, 12, 6)}, but it isn't`,
        `You pasted ${to}. You've sent to ${cp} from this device before. ${m.reason}, which is how address-poisoning and typo scams work.${await missing()}`,
        { fix: [`Send to ${cp} if that's who you meant. Copy it from your address book or from the receiver, never from your history.`, "If the receiver really changed accounts, confirm it with them another way."],
          evidence: [{ label: "You pasted", value: short(to, 10, 8) }, { label: "You sent to", value: short(cp, 10, 8) }] });
    }
  }

  const hist = await senderHistory(ctx);
  const compared = `${book.length} saved contact${book.length === 1 ? "" : "s"}${device.length ? ` and ${device.length} send${device.length === 1 ? "" : "s"} from this device` : ""}`;
  if (!hist) {
    if (!book.length && !device.length) return skipped("R7", "No address book or sender account to compare with.");
    return f("R7", "PASS", "NO_LOOKALIKE", "No lookalike of your contacts", `Compared with ${compared}. Gideon couldn't tell which account you're sending from, so your on-chain history wasn't compared.`);
  }
  if (!hist.ok) {
    // Info-only: a slow or rate-limited history never holds up the verdict. Contacts were compared above.
    return f("R7", "PASS", "HISTORY_UNAVAILABLE", book.length ? "No lookalike of your contacts" : "Couldn't compare with your history",
      `Couldn't read your recent history in time (${hist.error}), so ${book.length || device.length ? `only your ${compared} were compared` : "no past recipients were compared"}. Check every character before you send.`);
  }

  const { from, transfers, pastRecipients, counterparties } = hist.value;
  if (to === from) return f("R7", "PASS", "OWN_ACCOUNT", "This is your own account", `${to} is the account you're sending from.`);
  const label = (a: string) => (a.length <= 40 ? a : short(a, 12, 6));
  const ev = (cp: string, as: string) => [{ label: "You pasted", value: short(to, 10, 8) }, { label: as, value: short(cp, 10, 8) }];
  const dust = transfers.find((t) => t.signer === to && t.receiver === from && t.depositYocto > 0 && t.depositYocto <= DUST_YOCTO);

  // Someone you've actually sent to before is known; don't flag it for looking like another one.
  if (!pastRecipients.includes(to)) {
    for (const cp of pastRecipients) {
      const m = lookalike(to, cp);
      if (!m) continue;
      if (dust) return poisoning(ctx, cp, dust, ev(cp, "You sent to"));
      return f("R7", "BLOCKED", "LOOKALIKE_OF_PAST_RECIPIENT", `Looks like ${label(cp)}, but it isn't`,
        `You pasted ${to}. You've sent to ${cp} before. ${m.reason}, which is how address-poisoning and typo scams work.${await missing()}`,
        { fix: [`Send to ${cp} if that's who you meant. Copy it from your address book or from the receiver, never from your history.`, "If the receiver really changed accounts, confirm it with them another way."],
          evidence: ev(cp, "You sent to") });
    }
  }
  counterparties.delete(to);
  for (const cp of counterparties) {
    const m = lookalike(to, cp);
    if (!m) continue;
    if (dust) return poisoning(ctx, cp, dust, ev(cp, "You've dealt with"));
    return f("R7", "ATTENTION", "LOOKALIKE_OF_HISTORY", `Looks like ${label(cp)} from your history`,
      `${to} is very close to ${cp}, an account in your history. ${m.reason}. Make sure you didn't copy the wrong one.${await missing()}`,
      { fix: ["Compare every character, or send from your address book."], evidence: ev(cp, "You've dealt with") });
  }
  const n = pastRecipients.length + counterparties.size;
  return f("R7", "PASS", "NO_LOOKALIKE", "No lookalike found",
    `Compared with ${compared} and ${n} account${n === 1 ? "" : "s"} from your recent history.`);
}

function poisoning(ctx: Ctx, cp: string, dust: Transfer, ev: Evidence[]): RuleResult {
  const to = ctx.c.normalized;
  return f("R7", "BLOCKED", "ADDRESS_POISONING", "Address poisoning: this lookalike sent you dust",
    `${to} looks like ${cp}, someone you've transacted with, and it recently sent you ${yoctoToNear(dust.depositYocto)} NEAR so it shows up in your history. That's the address-poisoning trick.`,
    { fix: [`Send to ${cp} if that's who you meant.`, "Never copy an address from your transaction history."],
      evidence: [...ev, { label: "Dust transfer", value: short(dust.hash), url: explorerTxUrl(ctx.input.network, dust.hash) }] });
}
