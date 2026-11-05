import type { Contact } from "./types.js";
import { lookalike, sharedEnds } from "./similarity.js";

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Add or replace a saved contact. The same label pointing at a new account keeps the old
 * account on `previous`, so a later check can say the contact changed (R23).
 */
export function mergeContact(list: Contact[], account: string, label?: string): Contact[] {
  const a = norm(account);
  if (!a) return list;
  const l = label?.trim();
  const fromLabel = l
    ? list.filter((c) => c.label && c.label.toLowerCase() === l.toLowerCase() && norm(c.account) !== a)
      .flatMap((c) => [norm(c.account), ...(c.previous ?? []).map(norm)])
    : [];
  const existing = list.find((c) => norm(c.account) === a);
  const previous = [...new Set([...(existing?.previous ?? []).map(norm), ...fromLabel])].filter((x) => x && x !== a);
  const rest = list.filter((c) => {
    if (norm(c.account) === a) return false;
    if (l && c.label && c.label.toLowerCase() === l.toLowerCase()) return false;
    return true;
  });
  const kept = l || existing?.label;
  return [...rest, { account: a, ...(kept ? { label: kept } : {}), ...(previous.length ? { previous } : {}) }];
}

/**
 * A poisoning-style partial match that is weaker than R7's lookalike (that one is BLOCKED).
 * Hex: the same 4+ characters at both ends, including when the lengths differ by more than
 * R7 allows. Named accounts: the same network and a shared prefix of 8+ characters.
 * Null when they're equal, or when lookalike() already owns the pair.
 */
export function partialRecipientMatch(candidate: string, trusted: string): string | null {
  const a = norm(candidate);
  const b = norm(trusted);
  if (!a || !b || a === b || lookalike(a, b)) return null;
  const hex = (s: string) => /^(0x)?[0-9a-f]{38,}$/.test(s);
  if (hex(a) || hex(b)) {
    if (!hex(a) || !hex(b) || a.startsWith("0x") !== b.startsWith("0x")) return null;
    const { head, tail } = sharedEnds(a.replace(/^0x/, ""), b.replace(/^0x/, ""));
    if (head >= 4 && tail >= 4) return `Same first ${head} and last ${tail} characters`;
    return null;
  }
  const suf = (s: string) => s.match(/\.(near|testnet|tg)$/)?.[0] ?? "";
  if (!suf(a) || suf(a) !== suf(b)) return null;
  const sa = a.slice(0, -suf(a).length);
  const sb = b.slice(0, -suf(b).length);
  if (sa.length < 8 || sb.length < 8 || sa === sb) return null;
  let head = 0;
  const n = Math.min(sa.length, sb.length);
  while (head < n && sa[head] === sb[head]) head++;
  if (head >= 8) return `Starts with the same ${head} characters`;
  return null;
}
