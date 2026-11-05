import type { Ctx } from "../context.js";
import { partialRecipientMatch } from "../contacts.js";
import { senderHistory } from "../history.js";
import { f, short, skipped, type RuleResult } from "./util.js";

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * R23 — a saved contact whose address changed, or a poisoning-style partial match of a
 * recent recipient that isn't already a full lookalike (R7 blocks those). LOOK AGAIN.
 * Agents pass this through the address book (`previous` on a contact). The extension also
 * compares sends it remembered on this device, and on-chain history when the sender is known.
 */
export async function r23Contacts(ctx: Ctx): Promise<RuleResult> {
  const to = ctx.c.normalized;
  if (!["near-named", "near-implicit", "eth-implicit", "hex64-uppercase"].includes(ctx.c.kind)) {
    return skipped("R23", "Not a NEAR account.");
  }
  const book = ctx.input.addressBook ?? [];
  const device = [...new Set((ctx.input.deviceSends ?? []).map(norm).filter(Boolean))];
  const hist = await senderHistory(ctx);
  const past = hist?.ok ? hist.value.pastRecipients : [];
  const compared = book.length > 0 || device.length > 0 || past.length > 0;
  if (!compared) return skipped("R23", "No address book or recent recipients to compare with.");

  for (const b of book) {
    const account = norm(b.account);
    const previous = (b.previous ?? []).map(norm).filter((x) => x && x !== account);
    if (!previous.length) continue;
    const name = b.label ?? account;
    if (account === to) {
      return f("R23", "ATTENTION", "CONTACT_CHANGED", `Saved contact ${name} changed address`,
        `Your address book now says ${account}${b.label ? ` for ${b.label}` : ""}. It used to say ${previous[0]}. Confirm the new address with them another way before you send.`,
        { fix: ["Confirm the new address with the person, not from the book alone.", `The previous account was ${previous[0]}.`],
          evidence: [{ label: "Saved contact now", value: account }, { label: "Used to be", value: previous[0]! }] });
    }
    if (previous.includes(to)) {
      return f("R23", "ATTENTION", "CONTACT_CHANGED", `This used to be saved contact ${name}`,
        `You saved ${to} before${b.label ? ` as ${b.label}` : ""}. Your address book now says ${account}. Don't send to the old one unless they confirmed it.`,
        { fix: [`Send to ${account} if that's who you mean, after you confirm it.`, "Don't pick the old address from history."],
          evidence: [{ label: "This address", value: to }, { label: "Address book now", value: account }] });
    }
  }

  const trusted = [...new Set([...book.map((b) => norm(b.account)), ...device, ...past])].filter((a) => a && a !== to);
  for (const cp of trusted) {
    const why = partialRecipientMatch(to, cp);
    if (!why) continue;
    const label = cp.length <= 40 ? cp : short(cp, 12, 6);
    return f("R23", "ATTENTION", "PARTIAL_RECIPIENT_MATCH", `Partly matches ${label}`,
      `${to} is not ${cp}. ${why} of a recipient you've used. That's how a poisoned address sits next to a real one. Look at every character before you send.`,
      { fix: [`Send to ${cp} if that's who you meant.`, "Copy it from your address book, not from a partial match."],
        evidence: [{ label: "This address", value: short(to, 10, 8) }, { label: "Recent recipient", value: short(cp, 10, 8) }] });
  }

  return f("R23", "PASS", "CONTACTS_UNCHANGED", "No changed contact or partial match",
    `Compared with ${book.length} saved contact${book.length === 1 ? "" : "s"} and ${device.length + past.length} recent recipient${device.length + past.length === 1 ? "" : "s"}.`);
}
