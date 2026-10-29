import type { Ctx } from "../context.js";
import { lookalike } from "../similarity.js";
import { yoctoToNear } from "../context.js";
import { explorerTxUrl } from "../networks.js";
import { couldNotCheck, f, skipped, short, type RuleResult } from "./util.js";

/** Native NEAR at or below this is "dust" (0.01 NEAR). */
const DUST_YOCTO = 1e22;

/** R7 — lookalike of a saved contact, or of a recent counterparty (address poisoning). */
export async function r07Lookalike(ctx: Ctx): Promise<RuleResult> {
  const { c, input } = ctx;
  if (!["near-named", "near-implicit", "eth-implicit", "hex64-uppercase"].includes(c.kind)) return skipped("R7", "Not a NEAR account.");
  const to = c.normalized;
  const book = input.addressBook ?? [];

  const saved = book.find((b) => b.account === to);
  if (saved) return f("R7", "PASS", "SAVED_CONTACT", `Saved contact${saved.label ? `: ${saved.label}` : ""}`, "Exact match with your address book.");

  for (const b of book) {
    if (lookalike(to, b.account)) {
      return f("R7", "BLOCKED", "LOOKALIKE_OF_CONTACT", `Looks like ${b.label ?? b.account}, but it isn't`,
        `You pasted ${to}. Your saved contact is ${b.account}. They differ by a few characters, which is how address-poisoning and typo scams work.`,
        { fix: [`Send to your saved contact ${b.account} instead.`, "If the receiver really changed accounts, confirm it with them another way."],
          evidence: [{ label: "You pasted", value: to }, { label: "Saved contact", value: b.account }] });
    }
  }

  if (!input.from) {
    if (!book.length) return skipped("R7", "No address book or sender account to compare with.");
    return f("R7", "PASS", "NO_LOOKALIKE", "No lookalike of your contacts", `Compared with ${book.length} saved contact${book.length === 1 ? "" : "s"}.`);
  }

  const from = input.from;
  const r = await ctx.ask(`nearblocks-${input.network}`, `history:${from}`, (s) => s.recentTransfers(input.network, from));
  if (!r.ok) return couldNotCheck("R7", "your recent history for lookalikes", r.error);

  const counterparties = new Set<string>();
  for (const t of r.value) {
    if (t.signer !== from) counterparties.add(t.signer);
    if (t.receiver !== from) counterparties.add(t.receiver);
  }
  counterparties.delete(to);
  const dust = r.value.find((t) => t.signer === to && t.receiver === from && t.depositYocto > 0 && t.depositYocto <= DUST_YOCTO);
  for (const cp of counterparties) {
    if (!lookalike(to, cp)) continue;
    const ev = [{ label: "You pasted", value: short(to, 10, 8) }, { label: "You've dealt with", value: short(cp, 10, 8) }];
    if (dust) {
      return f("R7", "BLOCKED", "ADDRESS_POISONING", "Address poisoning: this lookalike sent you dust",
        `${to} looks like ${cp}, someone you've transacted with, and it recently sent you ${yoctoToNear(dust.depositYocto)} NEAR so it shows up in your history. That's the address-poisoning trick.`,
        { fix: [`Send to ${cp} if that's who you meant.`, "Never copy an address from your transaction history."],
          evidence: [...ev, { label: "Dust transfer", value: short(dust.hash), url: explorerTxUrl(input.network, dust.hash) }] });
    }
    return f("R7", "ATTENTION", "LOOKALIKE_OF_HISTORY", `Looks like ${short(cp, 12, 6)} from your history`,
      `${to} is very close to ${cp}, an account you've transacted with. Make sure you didn't copy the wrong one.`,
      { fix: ["Compare every character, or send from your address book."], evidence: ev });
  }
  return f("R7", "PASS", "NO_LOOKALIKE", "No lookalike found",
    `Compared with ${book.length} saved contact${book.length === 1 ? "" : "s"} and ${counterparties.size} recent counterpart${counterparties.size === 1 ? "y" : "ies"}.`);
}
