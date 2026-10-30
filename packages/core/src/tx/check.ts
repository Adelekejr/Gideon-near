import type { Contact, Evidence, Finding, Network, Sources, Verdict } from "../types.js";
import { classify, networkOfName } from "../classify.js";
import { makeCtx } from "../context.js";
import { drainerCheck, type DrainerCache } from "../drainer.js";
import { verdictOf, headlineOf, ENGINE_VERSION } from "../engine.js";
import { tokensFor, exchangesFor } from "../data.js";
import { explorerAccountUrl } from "../networks.js";
import { withTimeout } from "../time.js";
import { f, short } from "../rules/util.js";
import type { TxAction, TxRequest } from "./decode.js";
import { parseTxRequest, type ParsedRequest } from "./input.js";

/*
 * Checks a transaction request before you approve it in your wallet. Read-only: nothing is signed
 * or sent. Four things, in plain words:
 *   T1  asks for FULL ACCESS to your account (AddKey full access, or a full-access sign-in)
 *   T2  calls a brand-new contract with little history, or one linked to drained wallets (R18)
 *   T3  sends your whole token (or NEAR) balance to an account Gideon hasn't seen before
 *   T4  lets an account Gideon hasn't seen before move your NFT (nft_approve, nft_transfer_call)
 *   T5  removes a key (DeleteKey): an app key is fine; a full-access key needs a second look; your
 *       last full-access key is blocked (it would lock you out). Read from the account's live keys.
 * False positives stay low: well-known contracts, your contacts and accounts you've sent to are
 * never "new"; a contract is only "new" when it's under 30 days old AND has under 1,000
 * transactions; "whole balance" means 95% or more.
 */

export const NEW_CONTRACT_DAYS = 30;
export const LOW_HISTORY_TXS = 1000;
export const WHOLE_BALANCE_SHARE = 0.95;
const DAY = 86_400_000;

/** Transaction-card text added in 0.3.0. */
export const TX_TEXT = {
  deleteKey: "This removes one key from your account",
  deleteFull: "This removes a full control key from your account",
  deleteLastFull: "This removes your last full control key. You would be locked out.",
  deleteKeyMissing: (a: string) => `This removes a key that isn't on ${a}`,
  deleteKeyUnknown: "Couldn't check: the key this removes",
  unreadable: "Gideon couldn't read this request",
  unreadableDetail: "It couldn't be decoded, so Gideon can't say it's safe. Check every detail in your wallet, or don't approve it.",
  walletUnreadable: "Your wallet couldn't read this request",
  walletUnreadableDetail: "Don't approve anything on this screen. Go back and start again from the app, or remove the key from Gideon's account page.",
} as const;

/** Big, long-running contracts and services. Never "new", never "unseen". */
const WELL_KNOWN: Record<Network, string[]> = {
  mainnet: [
    "near", "wrap.near", "usdt.tether-token.near", "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    "v2.ref-finance.near", "intents.near", "meta-pool.near", "lst.rhealab.near", "linear-protocol.near",
    "social.near", "x.paras.near", "marketplace.paras.near", "marketplace.mintbase1.near", "mintbase1.near",
    "contract.main.burrow.near", "aurora", "token.v2.ref-finance.near", "poolv1.near", "lockup.near",
  ],
  testnet: [
    "testnet", "wrap.testnet", "v1.social08.testnet", "intents.testnet", "ref-finance-101.testnet",
    "meta-v2.pool.testnet", "market.mintspace2.testnet", "usdc.fakes.testnet", "usdt.fakes.testnet",
  ],
};

export function wellKnown(network: Network, account: string): boolean {
  const a = account.toLowerCase();
  return WELL_KNOWN[network].includes(a)
    || tokensFor(network).some((t) => t.contract === a)
    || exchangesFor(network).some((e) => e.id === a);
}

export interface TxCheckInput {
  /** A wallet sign or sign-in link, raw base64 transactions (comma-separated), or JSON transactions. */
  request: string | object;
  /** Used when the request doesn't say (the wallet link or account names usually do). */
  network?: Network;
  /** Signer to assume when the request doesn't name one (e.g. the wallet account the page shows). */
  signerId?: string;
  /** Your own accounts, saved contacts and accounts you've sent to from this device: never "unseen". */
  myAccounts?: string[];
  addressBook?: Contact[];
  deviceSends?: string[];
  /** The site asking, when known (the extension passes the page or callback host). */
  origin?: string;
}

export interface TxCheckOptions {
  now?: number;
  sourceTimeoutMs?: number;
  /** Limit for each drained-wallet check (R18). Default 8 s. */
  drainerTimeoutMs?: number;
  drainerCache?: DrainerCache;
}

export interface TxCheckResult {
  engine: string;
  kind: "transaction";
  network: Network;
  verdict: Verdict;
  headline: Finding | null;
  findings: Finding[];
  /** What Gideon read from the request: every transaction and its actions. */
  transactions: TxRequest[];
  signIn?: ParsedRequest["signIn"];
  signer?: string;
  origin?: string;
  source: ParsedRequest["source"];
  checkedAt: string;
  ms: number;
}

const ft = (a: TxAction): a is Extract<TxAction, { type: "FunctionCall" }> => a.type === "FunctionCall";
const argStr = (args: unknown, k: string): string | undefined => {
  const v = (args as Record<string, unknown> | null)?.[k];
  return typeof v === "string" || typeof v === "number" ? String(v).trim() : undefined;
};

/** "less than a day", "1 day", "12 days". */
export function daysText(n: number): string {
  return n < 1 ? "less than a day" : n === 1 ? "1 day" : `${n} days`;
}

function fmtUnits(raw: bigint, decimals: number): string {
  if (decimals <= 0) return raw.toString();
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = (raw % base).toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${frac ? "." + frac : ""}`;
}

function inferNetwork(parsed: ParsedRequest, input: TxCheckInput): Network {
  if (parsed.network) return parsed.network;
  if (input.network) return input.network;
  for (const t of parsed.transactions) {
    for (const a of [t.signerId, t.receiverId]) {
      const n = a ? networkOfName(a) : null;
      if (n) return n;
    }
  }
  return "mainnet";
}

const nearKind = (a: string) => ["near-named", "near-implicit", "eth-implicit"].includes(classify(a).kind);

export async function checkTransaction(input: TxCheckInput, sources: Sources, opts: TxCheckOptions = {}): Promise<TxCheckResult> {
  const t0 = Date.now();
  const now = opts.now ?? Date.now();
  const parsed = parseTxRequest(input.request);
  const network = inferNetwork(parsed, input);
  const txs = parsed.transactions.map((t) => (t.signerId || !input.signerId ? t : { ...t, signerId: input.signerId.trim().toLowerCase() }));
  const signer = txs.find((t) => t.signerId)?.signerId;
  const origin = input.origin ?? parsed.site;
  const timeout = opts.sourceTimeoutMs ?? 10_000;
  const ask = <T>(p: () => Promise<T>) => withTimeout(Promise.resolve().then(p), timeout, "A lookup");

  const mine = new Set([...(input.myAccounts ?? []), ...txs.map((t) => t.signerId ?? "")].map((x) => x.trim().toLowerCase()).filter(Boolean));
  const known = new Set([...(input.addressBook ?? []).map((c) => c.account), ...(input.deviceSends ?? [])].map((x) => x.trim().toLowerCase()));
  const seen = (a: string) => mine.has(a) || known.has(a) || wellKnown(network, a);

  const findings: Finding[] = [];
  const acctEv = (label: string, a: string): Evidence => ({ label, value: a, url: explorerAccountUrl(network, a) });

  /* ---- T1: full access ---- */
  const fullKeys: { tx: TxRequest; key: string }[] = [];
  for (const t of txs) for (const a of t.actions) if (a.type === "AddKey" && a.fullAccess) fullKeys.push({ tx: t, key: a.publicKey });
  if (parsed.signIn?.fullAccess || fullKeys.length) {
    const key = parsed.signIn?.publicKey ?? fullKeys[0]?.key;
    const account = fullKeys[0]?.tx.signerId ?? signer;
    findings.push(f("T1", "BLOCKED", parsed.signIn ? "FULL_ACCESS_SIGN_IN" : "FULL_ACCESS_KEY",
      "This site is asking for FULL ACCESS to your account.",
      "A full-access key can move all your funds. Normal sign-ins never need this.",
      { evidence: [
        ...(origin ? [{ label: "Site", value: origin }] : []),
        ...(account ? [acctEv("Account", account)] : []),
        ...(key ? [{ label: "Key", value: short(key, 16, 6) }] : []),
      ] }));
  }

  /* ---- T2: the contracts this calls ---- */
  const called = [...new Set(txs.filter((t) => t.actions.some(ft)).map((t) => t.receiverId))]
    .filter((c) => nearKind(c) && !mine.has(c) && !known.has(c) && !wellKnown(network, c));
  // Accounts that would receive value or control: checked against the drained-wallet pattern too.
  const counterparts = new Set<string>();

  /* ---- T3 / T4 ---- */
  type Move = { token: string; contract: string | null; to: string; amount: bigint; signer: string };
  const moves: Move[] = [];
  const nfts: { contract: string; tokenId: string; to: string; signer?: string; how: string }[] = [];
  for (const t of txs) {
    for (const a of t.actions) {
      if (a.type === "Transfer" && t.signerId && t.receiverId !== t.signerId) {
        moves.push({ token: "NEAR", contract: null, to: t.receiverId, amount: BigInt(a.deposit), signer: t.signerId });
      }
      if (!ft(a)) continue;
      const to = argStr(a.args, "receiver_id")?.toLowerCase();
      if ((a.methodName === "ft_transfer" || a.methodName === "ft_transfer_call") && to && t.signerId) {
        const amt = argStr(a.args, "amount");
        if (amt && /^\d+$/.test(amt)) moves.push({ token: t.receiverId, contract: t.receiverId, to, amount: BigInt(amt), signer: t.signerId });
      }
      if (a.methodName === "nft_approve" || a.methodName === "nft_transfer_call" || a.methodName === "nft_transfer") {
        const who = (a.methodName === "nft_approve" ? argStr(a.args, "account_id") : to)?.toLowerCase();
        const tokenId = argStr(a.args, "token_id");
        if (who && tokenId != null) nfts.push({ contract: t.receiverId, tokenId, to: who, ...(t.signerId ? { signer: t.signerId } : {}), how: a.methodName });
      }
    }
  }

  const work: Promise<void>[] = [];

  // New contract: age (indexer, archival) and how many transactions it has.
  for (const c of called) {
    work.push((async () => {
      const ctx = makeCtx({ to: c, network, asset: { symbol: "NEAR" }, destination: "unknown" }, classify(c), sources, now, null, { sourceTimeoutMs: timeout, optionalBudgetMs: timeout });
      const facts = await ctx.accountFacts().catch(() => null);
      if (!facts || facts.exists === null) {
        findings.push(f("T2", "COULD_NOT_CHECK", "CONTRACT_UNKNOWN", `Couldn't check: ${c}`,
          "A data source didn't answer, so Gideon couldn't see how old this contract is. Gideon won't call this request safe until it can check. Try again in a minute."));
        return;
      }
      // Only accounts that run code are contracts; calling one without code does nothing.
      if (facts.exists !== true || facts.contract === false) return;
      let days: number | null = null;
      if (facts.createdAt) days = Math.max(0, Math.floor((now - Date.parse(facts.createdAt)) / DAY));
      else if (facts.created === "after-indexer" && facts.chainAgeDays != null && facts.chainAgeDays < 7) days = facts.chainAgeDays;
      if (days == null || days >= NEW_CONTRACT_DAYS) return;
      let count: number | null = null;
      if (sources.txCount) count = await ask(() => sources.txCount!(network, c)).catch(() => null);
      const little = count != null ? count < LOW_HISTORY_TXS : days < 7;
      if (!little) return;
      findings.push(f("T2", "ATTENTION", "NEW_CONTRACT",
        `You're about to call ${c}.`,
        `It was created ${daysText(days)} ago and has very little history.`,
        { evidence: [
          acctEv("Contract", c),
          ...(facts.createdAt ? [{ label: "Created", value: facts.createdAt.replace("T", " ").slice(0, 16) + " UTC" }] : []),
          ...(count != null ? [{ label: "Transactions", value: count.toLocaleString("en-US") }] : []),
        ] }));
    })());
  }

  // Whole balance to an account Gideon hasn't seen: summed per signer and token across the request.
  const sums = new Map<string, Move>();
  for (const m of moves) {
    const k = `${m.signer}|${m.contract ?? ""}|${m.to}`;
    const prev = sums.get(k);
    sums.set(k, prev ? { ...prev, amount: prev.amount + m.amount } : { ...m });
  }
  for (const m of sums.values()) {
    if (seen(m.to) || m.amount <= 0n) continue;
    counterparts.add(m.to);
    work.push((async () => {
      try {
        let balance: bigint | null;
        let symbol = "NEAR";
        let decimals = 24;
        if (m.contract) {
          const [bal, meta] = await Promise.all([
            sources.ftBalance ? ask(() => sources.ftBalance!(network, m.contract!, m.signer)) : Promise.resolve(null),
            ask(() => sources.ftMetadata(network, m.contract!)).catch(() => null),
          ]);
          balance = bal == null ? null : BigInt(bal);
          symbol = meta?.symbol || short(m.contract, 14, 0);
          decimals = meta?.decimals ?? 0;
        } else {
          const acct = await ask(() => sources.viewAccount(network, m.signer));
          balance = acct ? BigInt(acct.amountYocto) : null;
        }
        if (balance == null || balance <= 0n) return;
        // amount / balance >= 95%, in integers.
        if (m.amount * 100n < balance * BigInt(Math.round(WHOLE_BALANCE_SHARE * 100))) return;
        if (!m.contract && sources.sentCount) {
          const before = await ask(() => sources.sentCount!(network, m.signer, m.to)).catch(() => 0);
          if (before > 0) return;
        }
        findings.push(f("T3", "ATTENTION", "WHOLE_BALANCE_UNSEEN",
          `This sends your whole ${symbol} balance to ${m.to}, which Gideon hasn't seen before.`, "",
          { evidence: [
            { label: "Amount", value: `${fmtUnits(m.amount, decimals)} ${symbol}` },
            { label: "Your balance", value: `${fmtUnits(balance, decimals)} ${symbol}` },
            acctEv("To", m.to),
          ] }));
      } catch (e) {
        findings.push(f("T3", "COULD_NOT_CHECK", "BALANCE_UNKNOWN", `Couldn't check: your ${m.contract ? short(m.contract, 14, 0) : "NEAR"} balance`,
          `A data source didn't answer (${e instanceof Error ? e.message : String(e)}). Gideon won't call this request safe until it can check. Try again in a minute.`));
      }
    })());
  }

  // NFT control to an account Gideon hasn't seen.
  for (const n of nfts) {
    if (seen(n.to)) continue;
    counterparts.add(n.to);
    work.push((async () => {
      let name = `#${n.tokenId}`;
      if (sources.nftToken) {
        const tok = await ask(() => sources.nftToken!(network, n.contract, n.tokenId)).catch(() => null);
        if (tok?.title) name = `${tok.title} (#${n.tokenId})`;
      }
      findings.push(f("T4", "ATTENTION", n.how === "nft_approve" ? "NFT_APPROVE_UNSEEN" : "NFT_TRANSFER_UNSEEN",
        `This lets ${n.to} move your NFT ${name}.`, "",
        { evidence: [acctEv("Collection", n.contract), acctEv("To", n.to)] }));
    })());
  }

  // Drained-wallet links (R18), for called contracts and accounts receiving value or control. At most 4.
  const drainTargets = [...new Set([...called, ...counterparts])].filter(nearKind).slice(0, 4);
  for (const d of drainTargets) {
    work.push((async () => {
      const x = await drainerCheck({ to: d, network, ...(signer ? { from: signer } : {}), ...(input.addressBook ? { addressBook: input.addressBook } : {}), myAccounts: [...mine] },
        sources, { timeoutMs: opts.drainerTimeoutMs ?? 8000 }, opts.drainerCache);
      if (x.status !== "BLOCKED" && x.status !== "ATTENTION") return;
      findings.push(f("T2", x.status, x.status === "BLOCKED" ? "DRAINER_LINKED" : "DRAINED_SENDER_LINKED",
        `${d} is linked to accounts that drained other wallets.`, x.detail,
        { ...(x.fix ? { fix: x.fix } : {}), evidence: [acctEv("Account", d), ...(x.evidence ?? [])] }));
    })());
  }

  // DeleteKey: which key it removes, from the account's live keys.
  for (const t of txs) {
    const dels = t.actions.filter((a): a is Extract<TxAction, { type: "DeleteKey" }> => a.type === "DeleteKey");
    if (!dels.length) continue;
    const acct = t.receiverId;
    work.push((async () => {
      let live: Awaited<ReturnType<NonNullable<Sources["accessKeys"]>>> | undefined;
      if (sources.accessKeys && nearKind(acct)) live = await ask(() => sources.accessKeys!(network, acct)).catch(() => undefined);
      for (const d of dels) {
        const ev: Evidence[] = [acctEv("Account", acct), { label: "Key", value: short(d.publicKey, 16, 6) }];
        if (live === undefined) {
          findings.push(f("T5", "COULD_NOT_CHECK", "DELETE_KEY_UNKNOWN", TX_TEXT.deleteKeyUnknown,
            "A data source didn't answer, so Gideon couldn't see which key this removes. Check the key shown in your wallet before you approve.", { evidence: ev }));
          continue;
        }
        const k = live?.find((x) => x.publicKey === d.publicKey);
        if (!k) {
          findings.push(f("T5", "ATTENTION", "DELETE_KEY_MISSING", TX_TEXT.deleteKeyMissing(acct),
            "Your wallet will likely reject it. Check that this is the right account and key.", { evidence: ev }));
          continue;
        }
        if (k.permission === "FullAccess") {
          const removedFull = new Set(dels.map((x) => x.publicKey).filter((pk) => live!.some((y) => y.publicKey === pk && y.permission === "FullAccess")));
          const left = live!.filter((y) => y.permission === "FullAccess" && !removedFull.has(y.publicKey)).length;
          findings.push(left === 0
            ? f("T5", "BLOCKED", "DELETE_LAST_FULL_KEY", TX_TEXT.deleteLastFull,
              "Without a full control key no one can sign for this account again, and its funds are stuck for good.", { evidence: ev })
            : f("T5", "ATTENTION", "DELETE_FULL_KEY", TX_TEXT.deleteFull,
              "Make sure it isn't the key your wallet signs with, or your seed-phrase backup.", { evidence: ev }));
          continue;
        }
        findings.push(f("T5", "PASS", "DELETE_APP_KEY", TX_TEXT.deleteKey,
          `It's an app key for ${k.permission.receiverId}. Removing it signs you out of that app; it can't move your funds.`, { evidence: ev }));
      }
    })());
  }

  await Promise.all(work);

  if (txs.some((t) => t.partial)) {
    findings.push(f("T1", "COULD_NOT_CHECK", "UNREADABLE_ACTION", "Couldn't read all of this request",
      "Part of it uses an action Gideon can't read yet, so it may do more than is shown here. Check it carefully in your wallet."));
  }
  if (!txs.length && !parsed.signIn) {
    findings.push(f("T1", "PASS", "PLAIN_SIGN_IN", "Normal sign-in: no full-access key", "This sign-in doesn't ask for a full-access key."));
  }
  if (!findings.length) {
    findings.push(f("T1", "PASS", "NOTHING_FOUND", "Nothing risky found in this request",
      "No full-access key, no brand-new contract, no whole-balance send or NFT approval to an account Gideon hasn't seen. Still check the details in your wallet."));
  }

  // Stable order: blocked first, then rule, then title.
  const rank = { BLOCKED: 0, ATTENTION: 1, COULD_NOT_CHECK: 2, PASS: 3, SKIPPED: 4 } as const;
  findings.sort((a, b) => rank[a.status] - rank[b.status] || a.rule.localeCompare(b.rule) || a.title.localeCompare(b.title));
  const verdict = verdictOf(findings);
  return {
    engine: ENGINE_VERSION, kind: "transaction", network, verdict, headline: headlineOf(findings, verdict) ?? findings[0] ?? null, findings,
    transactions: txs, ...(parsed.signIn ? { signIn: parsed.signIn } : {}), ...(signer ? { signer } : {}), ...(origin ? { origin } : {}),
    source: parsed.source, checkedAt: new Date(now).toISOString(), ms: Date.now() - t0,
  };
}

/**
 * The answer when a request can't be decoded (a wallet link Gideon can't read), or the wallet itself
 * says it couldn't read it. Never SAFE: Gideon can't vouch for what it couldn't read.
 */
export function unreadableRequest(o: { network?: Network; wallet?: boolean; now?: number } = {}): TxCheckResult {
  const now = o.now ?? Date.now();
  const finding = o.wallet
    ? f("T1", "COULD_NOT_CHECK", "WALLET_UNREADABLE", TX_TEXT.walletUnreadable, TX_TEXT.walletUnreadableDetail)
    : f("T1", "COULD_NOT_CHECK", "UNREADABLE_REQUEST", TX_TEXT.unreadable, TX_TEXT.unreadableDetail);
  return {
    engine: ENGINE_VERSION, kind: "transaction", network: o.network ?? "mainnet", verdict: "ATTENTION", headline: finding, findings: [finding],
    transactions: [], source: "sign-link", checkedAt: new Date(now).toISOString(), ms: 0,
  };
}
