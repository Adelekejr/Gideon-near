import { classify, networkOfName, type Network } from "@gideon/core";

/**
 * Auto network: which NEAR network is this page sending on?
 *
 * Everything here runs in the content script, on this device. Gideon looks at the page's
 * address (host, path, query), at short text that is a NEAR account name or a network badge,
 * and at the recipient you typed. No page text leaves the page: only the answer
 * ("testnet", "mainnet" or "not sure") goes to the extension's worker with the check.
 */

export type NetworkMode = "auto" | Network;

export type NetSource = "manual" | "url" | "account" | "page-account" | "label" | "recipient" | "both" | "default";

export interface NetHint {
  /** null = the page gave no usable signal. */
  network: Network | null;
  source: NetSource;
  /** Sure enough to stop a send whose recipient is on the other network. */
  sure: boolean;
  /** Short reason, in words, for the card: "from your wallet's account". */
  why: string;
  /** The account or host the hint came from, when there is one. */
  evidence?: string;
}

const NONE: NetHint = { network: null, source: "default", sure: false, why: "no network shown on this page" };

/* ---------- 1. the page address ---------- */

interface HostRule {
  /** Exact host, or a suffix starting with "." */
  host: string;
  network: Network;
  name: string;
}

/**
 * Wallets and NEAR apps that live on a different host per network. Sources:
 * near/wallet-selector (MyNearWallet resolveWalletUrl), Bitte docs (wallet URLs per network),
 * NearBlocks / Pikespeak / Ref explorers. Single-host wallets with an in-app switch
 * (Meteor wallet.meteorwallet.app, Intear wallet.intear.tech, HOT) are deliberately absent:
 * their host says nothing about the network, so the account and badges decide there.
 */
export const HOSTS: HostRule[] = [
  { host: "testnet.mynearwallet.com", network: "testnet", name: "MyNearWallet testnet" },
  { host: "app.mynearwallet.com", network: "mainnet", name: "MyNearWallet" },
  { host: "testnet.wallet.bitte.ai", network: "testnet", name: "Bitte Wallet testnet" },
  { host: "wallet.bitte.ai", network: "mainnet", name: "Bitte Wallet" },
  { host: "testnet.wallet.mintbase.xyz", network: "testnet", name: "Mintbase Wallet testnet" },
  { host: "wallet.mintbase.xyz", network: "mainnet", name: "Mintbase Wallet" },
  { host: "wallet.testnet.near.org", network: "testnet", name: "NEAR Wallet testnet" },
  { host: "wallet.near.org", network: "mainnet", name: "NEAR Wallet" },
  { host: "testnet.nearblocks.io", network: "testnet", name: "NearBlocks testnet" },
  { host: "nearblocks.io", network: "mainnet", name: "NearBlocks" },
  { host: "testnet.pikespeak.ai", network: "testnet", name: "Pikespeak testnet" },
  { host: "pikespeak.ai", network: "mainnet", name: "Pikespeak" },
  { host: "testnet.ref.finance", network: "testnet", name: "Ref testnet" },
  { host: "testnet.app.rhea.finance", network: "testnet", name: "Rhea testnet" },
  { host: "testnet.near.org", network: "testnet", name: "NEAR testnet site" },
];

/** Hosts whose network is set inside the app. Named so the card can say why it looked further. */
export const SWITCH_HOSTS: Record<string, string> = {
  "wallet.meteorwallet.app": "Meteor Wallet",
  "wallet.intear.tech": "Intear Wallet",
  "app.hot-labs.org": "HOT Wallet",
  "my.herewallet.app": "HOT Wallet",
};

export function fromUrl(href: string): NetHint | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  for (const r of HOSTS) {
    if (host === r.host) return { network: r.network, source: "url", sure: true, why: `from the site (${r.name})`, evidence: host };
  }
  // ?network=testnet, ?networkId=mainnet, #/testnet/..., /testnet/... in the path
  for (const [k, v] of u.searchParams) {
    if (/^(network|networkid|net|chain)$/i.test(k)) {
      const n = v.toLowerCase();
      if (n === "testnet" || n === "mainnet") return { network: n, source: "url", sure: true, why: `from the page address (${k}=${n})`, evidence: host };
    }
  }
  const pathish = `${u.pathname}${u.hash}`.toLowerCase();
  const seg = pathish.match(/(?:^|[/#?&=])(testnet|mainnet)(?=$|[/?&#])/);
  if (seg) return { network: seg[1] as Network, source: "url", sure: true, why: `from the page address (/${seg[1]})`, evidence: host };
  // Any other site served from a testnet.* host is a testnet build.
  if (/^testnet[.-]/.test(host) || /\.testnet\./.test(host)) return { network: "testnet", source: "url", sure: true, why: "from the site address (testnet.*)", evidence: host };
  return null;
}

/* ---------- 2. text on the page ---------- */

/** A whole text that is one named NEAR account on a known network. */
const ACCOUNT = /^@?[a-z\d][a-z\d._\-…]{0,62}\.(testnet|near)$/;
const BADGE = /^(testnet|mainnet)( mode| network)?$/i;

/** One short text from the page, and whether it sits in the page header (where wallets show who's signed in). */
export interface TextSignal {
  text: string;
  header: boolean;
}

export function fromTexts(signals: TextSignal[]): NetHint | null {
  const head = new Set<string>();
  const body = new Set<string>();
  const badges = new Set<Network>();
  for (const s of signals) {
    const t = s.text.trim().replace(/\s+/g, " ");
    if (!t || t.length > 70) continue;
    const lower = t.toLowerCase();
    if (ACCOUNT.test(lower)) (s.header ? head : body).add(lower.replace(/^@/, ""));
    const b = t.match(BADGE);
    if (b) badges.add(b[1]!.toLowerCase() as Network);
  }
  const net = (set: Set<string>) => {
    const nets = new Set([...set].map((a) => networkOfName(a)));
    return nets.size === 1 ? [...nets][0]! : null;
  };
  const h = net(head);
  if (h) {
    const acc = [...head][0]!;
    return { network: h, source: "account", sure: true, why: `from your wallet's account (${acc})`, evidence: acc };
  }
  // Wallet menus list both "Testnet" and "Mainnet" in their switch, so a badge counts only when it's the only one.
  if (badges.size === 1) {
    const n = [...badges][0]!;
    return { network: n, source: "label", sure: false, why: `the page says "${n === "testnet" ? "Testnet" : "Mainnet"}"` };
  }
  const b = net(body);
  if (b) {
    const acc = [...body][0]!;
    return { network: b, source: "page-account", sure: false, why: `accounts on this page end in .${b === "testnet" ? "testnet" : "near"} (${acc})`, evidence: acc };
  }
  return null;
}

/**
 * The account signed in to the wallet: the one named NEAR account shown in the page header
 * (Meteor's account bar and the like). Null when the header shows none, or more than one.
 * Gideon passes it as the sender, so it can compare the recipient with your own history.
 */
export function signedInAccount(signals: TextSignal[]): string | null {
  const head = new Set<string>();
  for (const s of signals) {
    if (!s.header) continue;
    const t = s.text.trim().toLowerCase().replace(/^@/, "");
    if (ACCOUNT.test(t) && !t.includes("…") && !t.includes("..")) head.add(t); // "alice-wal...testnet" is shortened, not a name
  }
  return head.size === 1 ? [...head][0]! : null;
}

/** Page signals in order of trust: the address, then the signed-in account, then badges and other accounts. */
export function pageHint(href: string, signals: TextSignal[]): NetHint {
  return fromUrl(href) ?? fromTexts(signals) ?? NONE;
}

/* ---------- 3. deciding, with the recipient ---------- */

export interface NetDecision {
  /** The network to check on, or "both" when nothing settles it. */
  network: Network | "both";
  /** May the engine stop a send because the recipient's suffix is the other network? */
  mismatchAllowed: boolean;
  hint: NetHint;
}

/**
 * The rule that matters: a network-mismatch block only when the user set the network,
 * or the page proves it (its address, or the signed-in account in its header).
 * Anything weaker gives way to the recipient's own suffix; with no suffix, check both.
 */
export function decide(mode: NetworkMode, hint: NetHint, recipient: string): NetDecision {
  if (mode !== "auto") {
    return { network: mode, mismatchAllowed: true, hint: { network: mode, source: "manual", sure: true, why: "set by you in Gideon" } };
  }
  const own = recipientNetwork(recipient);
  if (hint.network && hint.sure) return { network: hint.network, mismatchAllowed: true, hint };
  if (own) {
    const why = hint.network && hint.network !== own
      ? `from the address you typed (.${own === "testnet" ? "testnet" : "near"}); ${hint.why}, so double-check your wallet's network`
      : hint.network
        ? `${hint.why}, and the address agrees`
        : `from the address you typed (.${own === "testnet" ? "testnet" : "near"})`;
    return { network: own, mismatchAllowed: false, hint: { network: own, source: hint.network === own ? hint.source : "recipient", sure: false, why } };
  }
  if (hint.network) return { network: hint.network, mismatchAllowed: false, hint };
  return { network: "both", mismatchAllowed: false, hint: { network: null, source: "both", sure: false, why: "couldn't tell from this page, so Gideon looked on both networks" } };
}

export function recipientNetwork(to: string): Network | null {
  const c = classify(to);
  return c.kind === "near-named" ? networkOfName(c.normalized) : null;
}

/* ---------- reading the page (DOM) ---------- */

const HEADER_SEL = 'header, nav, [role="banner"], [class*="header" i], [class*="navbar" i], [class*="topbar" i], [class*="account-name" i], [class*="accountName" i], [class*="profile" i], [class*="user-account" i], [class*="account-menu" i], [class*="accountMenu" i], [class*="user-menu" i], [class*="userMenu" i], [data-test-id="currentUser"]';

/**
 * Short texts that look like an account name or a network badge, with whether each is in the header.
 * Skips anything inside the recipient's own form or container, and anything inside Gideon's card.
 * "Header" = inside a header-like element, or near the top of the page (wallet apps on phones
 * often draw the account bar as a plain div).
 */
export function collectSignals(doc: Document, exclude?: Element | null, topPx = 140): TextSignal[] {
  const out: TextSignal[] = [];
  const body = doc.body;
  if (!body) return out;
  const walker = doc.createTreeWalker(body, 4 /* NodeFilter.SHOW_TEXT */);
  let n: Node | null;
  let seen = 0;
  while ((n = walker.nextNode()) && seen < 4000) {
    seen++;
    const t = (n.nodeValue ?? "").trim();
    if (t.length < 5 || t.length > 70) continue;
    // Account names and network badges; 64-hex accounts (full or shortened) only count as the sender.
    if (!/(\.near|\.testnet|testnet|mainnet)/i.test(t) && !/^[0-9a-f]{64}$|^[0-9a-f]{4,12}(\.{2,3}|…)[0-9a-f]{4,12}$/i.test(t)) continue;
    const el = n.parentElement;
    if (!el || el.closest('gideon-watch, script, style, noscript, template, datalist, [role="listbox"], [role="option"], [role="combobox"]')) continue;
    if (exclude && (exclude.contains(el) || el.contains(exclude))) continue;
    let header = !!el.closest(HEADER_SEL);
    if (!header) {
      try {
        const r = el.getBoundingClientRect();
        header = r.height > 0 && r.top + (doc.defaultView?.scrollY ?? 0) < topPx;
      } catch {
        /* no layout */
      }
    }
    out.push({ text: t, header });
  }
  return out;
}

/**
 * The field's own wrapper, where wallets draw the typed value back and its suggestions; never read
 * as "your account". Kept small on purpose: a "From: you.testnet" line in the same form is a good signal.
 */
export function recipientScope(field: Element): Element {
  const p = field.parentElement;
  return p && p !== field.ownerDocument.body ? p : field;
}
