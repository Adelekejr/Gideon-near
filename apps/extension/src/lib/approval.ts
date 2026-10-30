import { decodeTransactions, parseWalletUrl, type Network } from "@gideon/core";

/*
 * Finds a wallet's "approve this transaction" request on the page you're looking at, so Gideon can
 * check it before you press Approve. Read on this device only, from two places:
 *   1. The page address. MyNearWallet (/sign?transactions=…) and Meteor's redirect flow
 *      (/connect/<network>/sign?transactions=…) carry the whole unsigned transactions there.
 *      Any other page whose address has a `transactions=` value that decodes as real NEAR
 *      transactions is read the same way (generic fallback; strict decoding, nothing guessed).
 *   2. Meteor's approval screen (wallet.meteorwallet.app), when the transactions aren't in the
 *      address (the pop-up flow passes them by message): the "Approve Transaction(s)" heading, the
 *      From / To explorer links, and Meteor's own full-access wording. Other pages get only the
 *      generic part of this: an approval heading AND full-access wording on the same screen.
 *   3. A wallet link Gideon can't decode, or a wallet screen saying it couldn't read the request
 *      (Meteor: "Couldn't parse the correct arguments for signing the transaction"): marked
 *      `unreadable`, so the card says so instead of "looks right".
 * Only the answer (the request, or signer / receiver / "asks for full access") goes to the
 * extension's worker. Never keys, never storage, never the clipboard.
 */

export interface ApprovalFound {
  /** A stable key for this request, so the same screen isn't checked twice. */
  key: string;
  /** What to check: the wallet link or base64 transactions, or JSON built from the screen. */
  request: string | object;
  /** Where it was read from, for the card's "network →" line. */
  from: "url" | "screen";
  network?: Network;
  signerId?: string;
  /** The site that asked (the wallet link's callback host), when known. */
  origin?: string;
  /** Gideon couldn't decode the link ("request"), or the wallet says it couldn't ("wallet"). */
  unreadable?: "request" | "wallet";
}

const METEOR = /(^|\.)meteorwallet\.app$/;
const HEADING = /^\s*(approve|confirm|sign)\s+(the\s+)?transactions?(\s*\(s\))?\s*$/i;
const FULL_ACCESS = /\bfull[\s-]access key\b|\bfull control of (this|your) account\b/i;
const WALLET_HOST = /(^|\.)(meteorwallet\.app|mynearwallet\.com|wallet\.near\.org|bitte\.ai|wallet\.bitte\.ai)$/;
/** What wallets show when they can't read a request (Meteor's couldnt_parse_arg_tx, and common forms). */
const WALLET_ERROR = /couldn['’]t parse the correct arguments|could not parse the (correct )?arguments|(invalid|malformed|unable to (parse|decode)|failed to (parse|decode)) (the )?transactions?\b/i;
const EXPLORER = /^https:\/\/(testnet\.)?nearblocks\.io\/address\/([a-z0-9._-]{2,64})\/?$/i;

/** The request in the page address, or null. */
export function approvalFromUrl(href: string): ApprovalFound | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  try {
    const parsed = parseWalletUrl(href);
    if (parsed && (parsed.transactions.length || parsed.signIn)) {
      return {
        key: `url:${u.host}${u.pathname}?${u.searchParams.get("transactions") ?? u.searchParams.get("public_key") ?? ""}`,
        request: href, from: "url",
        ...(parsed.network ? { network: parsed.network } : {}),
        ...(parsed.site ? { origin: parsed.site } : {}),
      };
    }
  } catch {
    /* not a link Gideon reads: try the generic way */
  }
  const raw = u.searchParams.get("transactions");
  if (!raw) return null;
  const unreadable = (): ApprovalFound | null => WALLET_HOST.test(u.hostname)
    ? { key: `url:${u.host}${u.pathname}?${raw}:unreadable`, request: raw, from: "url", unreadable: "request", ...(networkOf(u) ? { network: networkOf(u)! } : {}) }
    : null;
  try {
    if (!decodeTransactions(raw).length) return unreadable();
  } catch {
    return unreadable();
  }
  return { key: `url:${u.host}${u.pathname}?${raw}`, request: raw, from: "url" };
}

/** Text a person can see: scripts, styles and templates are left out. */
function visibleText(el: Element): string {
  const parts: string[] = [];
  const walk = (n: Node): void => {
    if (n.nodeType === 3) parts.push(n.nodeValue ?? "");
    else if (n.nodeType === 1 && !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/i.test((n as Element).tagName)) n.childNodes.forEach(walk);
  };
  walk(el);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function networkOf(u: URL): Network | undefined {
  const m = /\/connect\/(mainnet|testnet)\//.exec(u.pathname) ?? /(testnet)/.exec(u.hostname);
  return m ? (m[1] as Network) : undefined;
}

/** A wallet screen that says it couldn't read the request, or null. */
export function walletErrorFromScreen(doc: Document, href: string): ApprovalFound | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (!WALLET_HOST.test(u.hostname) && !u.searchParams.has("transactions")) return null;
  const body = doc.body ? visibleText(doc.body) : "";
  if (!WALLET_ERROR.test(body)) return null;
  const net = networkOf(u);
  return { key: `wallet-error:${u.host}${u.pathname}?${u.searchParams.get("transactions") ?? ""}`, request: "", from: "screen", unreadable: "wallet", ...(net ? { network: net } : {}) };
}

/** The request shown on an approval screen, or null when this isn't one. */
export function approvalFromScreen(doc: Document, href: string): ApprovalFound | null {
  let host = "";
  try {
    host = new URL(href).hostname;
  } catch {
    return null;
  }
  const heading = [...doc.querySelectorAll("h1, h2, h3, h4, [role=heading]")].some((h) => HEADING.test(visibleText(h)));
  if (!heading) return null;
  const body = doc.body ? visibleText(doc.body) : "";
  const fullAccess = FULL_ACCESS.test(body);
  const meteor = METEOR.test(host);
  if (!meteor && !fullAccess) return null; // generic pages: only the full-access check, never a guess

  // Meteor lists From then To as explorer links: the signer, then the contract or account.
  const ids: string[] = [];
  let network: Network | undefined;
  if (meteor) {
    for (const a of doc.querySelectorAll<HTMLAnchorElement>('a[href*="nearblocks.io/address/"]')) {
      const m = EXPLORER.exec(a.getAttribute("href") ?? "");
      if (!m) continue;
      network ??= m[1] ? "testnet" : "mainnet";
      const id = m[2]!.toLowerCase();
      if (!ids.includes(id)) ids.push(id);
    }
    const path = /\/connect\/(mainnet|testnet)\//.exec(new URL(href).pathname);
    if (path) network = path[1] as Network;
  }
  const [signer, receiver] = ids;
  if (!fullAccess && !receiver) return null;
  const actions: object[] = [];
  if (fullAccess) actions.push({ type: "AddKey", params: { publicKey: "", accessKey: { permission: "FullAccess" } } });
  // The screen doesn't say which method; a call with no name is checked only for the contract itself.
  if (receiver && receiver !== signer) actions.push({ type: "FunctionCall", params: { methodName: "", args: {}, gas: "0", deposit: "0" } });
  const tx = { ...(signer ? { signerId: signer } : {}), receiverId: receiver ?? signer ?? "unknown-account", actions };
  return {
    key: `screen:${host}:${signer ?? ""}>${receiver ?? ""}:${fullAccess ? 1 : 0}`,
    request: tx, from: "screen",
    ...(network ? { network } : {}),
    ...(signer ? { signerId: signer } : {}),
  };
}

/** The address first (it has the whole request), then the screen. */
export function findApproval(doc: Document, href: string): ApprovalFound | null {
  // The wallet's own "couldn't read it" beats what Gideon read from the link.
  return walletErrorFromScreen(doc, href) ?? approvalFromUrl(href) ?? approvalFromScreen(doc, href);
}
