import type { Network } from "@gideon/core";
import type { TextSignal } from "./network.js";

/**
 * Who's sending: the account the wallet shows as signed in.
 *
 * Wallets shorten long names in their header. Meteor shows `alice-wallet.testnet` as
 * `alice-wal...testnet` (first 9 characters, "...", then the last 7), so the full name often
 * isn't on the page at all. Gideon then matches the shortened form against full names elsewhere on
 * the page and the accounts you added as yours ("Your accounts" in the popup, or "Add to Your
 * accounts" on a card). Nothing is added without you: any page can show any name. Saved contacts
 * are never used: they're other people.
 */

const FULL = /^[a-z\d][a-z\d._-]{0,62}\.(testnet|near)$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SHORT = /^([a-z\d][a-z\d._-]{1,40}?)(?:\.{2,3}|…)([a-z\d._-]{2,20})$/;
const VALID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** What the content script read from the page (names only, never other page text). */
export interface SenderHint {
  /** The one full account name the page shows as signed in. */
  account?: string;
  /** Where `account` came from. Never saved as yours automatically (since 0.3.1). */
  via?: SenderVia;
  /** The wallet whose own record named the account (via "wallet"). */
  wallet?: string;
  /** Several different accounts claim to be the sender: Gideon doesn't guess. */
  ambiguous?: string[];
  /** The shortened name shown in the header, e.g. "alice-wal...testnet". */
  shown?: string;
  /** Full account names elsewhere on the page that fit `shown`. */
  candidates?: string[];
}

export type SenderVia = "wallet" | "header" | "dapp" | "url" | "title";

/** Account names the page states outside its visible text (see wallets.ts). */
export interface PageAccounts {
  /** A known wallet's own record of who's signed in (e.g. MyNearWallet's active account). */
  wallet?: { name: string; accounts: string[] };
  /** A NEAR sign-in this site keeps (near-api-js "…_wallet_auth_key"). */
  dapp?: string[];
  /** ?account_id= / ?signer_id= in the page address (what wallets add after sign-in). */
  url?: string[];
  /** Account names in the page title. */
  title?: string[];
}

/** The sender Gideon used, and how it knows, for the card. */
export interface SenderUsed {
  account: string | null;
  why: string;
  /**
   * The account is one you added under "Your accounts". Only then does it count as yours (never
   * for an account Gideon only read off the page: any page can show any name).
   */
  confirmed?: boolean;
}

const clean = (t: string) => t.trim().toLowerCase().replace(/^@/, "").replace(/\s+/g, "");

export function isAccount(a: string): boolean {
  return HEX64.test(a) || (a.length >= 2 && a.length <= 64 && FULL.test(a) && VALID.test(a));
}

/** "alice-wal...testnet" → { head: "alice-wal", tail: "testnet" }; null if it isn't a shortened name. */
export function shortened(text: string): { head: string; tail: string } | null {
  const t = clean(text);
  if (t.length > 50) return null;
  const m = t.match(SHORT);
  if (!m) return null;
  return { head: m[1]!, tail: m[2]! };
}

/** Does `account` fit the shortened form? It must be longer than what's shown. */
export function fits(shown: string, account: string): boolean {
  const s = shortened(shown);
  const a = clean(account);
  if (!s || !isAccount(a)) return false;
  return a.length > s.head.length + s.tail.length && a.startsWith(s.head) && a.endsWith(s.tail);
}

export function networkOfShown(shown: string): Network | null {
  const s = shortened(shown);
  if (!s) return null;
  return s.tail.endsWith("testnet") ? "testnet" : s.tail.endsWith("near") ? "mainnet" : null;
}

/**
 * Read the sender hint. Order: a known wallet's own record; else every full name the page offers
 * as "you" (header, the site's NEAR sign-in, ?account_id=, the title), which must all agree; else a
 * shortened header name. Anything that disagrees means no sender (never a guess).
 */
export function senderHint(signals: TextSignal[], page: PageAccounts = {}): SenderHint {
  const valid = (l?: string[]) => [...new Set((l ?? []).map(clean).filter(isAccount))];
  const own = valid(page.wallet?.accounts);
  if (own.length === 1) return { account: own[0]!, via: "wallet", wallet: page.wallet!.name };
  if (own.length > 1) return { ambiguous: own };

  const fullHead = new Set<string>();
  const shownHead = new Set<string>();
  const everywhere = new Set<string>();
  for (const s of signals) {
    const t = clean(s.text);
    if (isAccount(t)) {
      everywhere.add(t);
      if (s.header) fullHead.add(t);
    } else if (s.header && shortened(t)) shownHead.add(t);
  }
  const tiers: [SenderVia, string[]][] = [["header", [...fullHead]], ["dapp", valid(page.dapp)], ["url", valid(page.url)], ["title", valid(page.title)]];
  const all = [...new Set(tiers.flatMap(([, l]) => l))];
  const shown = shownHead.size === 1 ? [...shownHead][0]! : undefined;
  if (all.length === 1) {
    const account = all[0]!;
    // A shortened header that doesn't fit the name means two different accounts on the page.
    if (shown && !fits(shown, account) && !fullHead.has(account)) return { ambiguous: [shown, account] };
    return { account, via: tiers.find(([, l]) => l.includes(account))![0] };
  }
  if (all.length > 1) return { ambiguous: all };
  if (shown) return { shown, candidates: [...everywhere].filter((a) => fits(shown, a)) };
  return {};
}

const VIA: Record<SenderVia, string> = {
  wallet: "", header: "from your wallet's header", dapp: "from this site's NEAR sign-in",
  url: "from the page address (account_id)", title: "from the page title",
};

/**
 * Decide the sender: a full header name; else the one page name or remembered account that fits
 * the shortened header; else none (the card says why, and how to fix it).
 */
export function resolveSender(hint: SenderHint | undefined, mine: string[]): SenderUsed {
  if (!hint) return { account: null, why: "" };
  if (hint.account) {
    const via = hint.via ?? "header";
    return { account: hint.account, why: via === "wallet" ? `from ${hint.wallet ?? "your wallet"}'s signed-in account` : VIA[via] };
  }
  if (hint.ambiguous?.length) {
    const fullOnes = hint.ambiguous.filter(isAccount);
    const known = [...new Set(mine.map(clean))].filter((a) => fullOnes.includes(a) || hint.ambiguous!.some((x) => fits(x, a)));
    if (known.length === 1) return { account: known[0]!, why: `the page shows more than one account; matched to your saved account` };
    return { account: null, why: `the page shows more than one account (${hint.ambiguous.slice(0, 3).join(", ")}), so Gideon won't guess. Add yours under "Your accounts" in Gideon's popup` };
  }
  if (!hint.shown) return { account: null, why: "" };
  const fromPage = [...new Set((hint.candidates ?? []).filter((a) => fits(hint.shown!, a)))];
  if (fromPage.length === 1) return { account: fromPage[0]!, why: `your wallet shows ${hint.shown}; the full name is on the page` };
  const known = [...new Set(mine.map(clean).filter((a) => fits(hint.shown!, a)))];
  if (known.length === 1) return { account: known[0]!, why: `your wallet shows ${hint.shown}; matched to your saved account` };
  return {
    account: null,
    why: known.length > 1
      ? `your wallet shows ${hint.shown}, which fits more than one of your accounts. Add the exact one under "Your accounts" in Gideon's popup`
      : `your wallet shows ${hint.shown} (shortened). Add your full account under "Your accounts" in Gideon's popup`,
  };
}

/** Add an account to the remembered list (newest first, at most 10). */
export function rememberAccount(list: string[], account: string): string[] {
  const a = clean(account);
  if (!isAccount(a)) return list;
  return [a, ...list.filter((x) => x !== a)].slice(0, 10);
}

/** A send started from this device, remembered so its recipient counts as a past recipient. */
export interface DeviceSend {
  network: Network;
  to: string;
  from?: string;
  at: number;
}

export function rememberSend(list: DeviceSend[], s: DeviceSend, max = 100): DeviceSend[] {
  const to = clean(s.to);
  if (!to) return list;
  const rest = list.filter((x) => !(x.network === s.network && x.to === to));
  return [{ ...s, to }, ...rest].slice(0, max);
}

export function sendsOn(list: DeviceSend[], network: Network): string[] {
  return list.filter((s) => s.network === network).map((s) => s.to);
}
