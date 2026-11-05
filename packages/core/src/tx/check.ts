import type { Contact, Evidence, Finding, Network, Sources, Verdict } from "../types.js";
import { classify, networkOfName } from "../classify.js";
import { makeCtx } from "../context.js";
import { drainerCheck, type DrainerCache } from "../drainer.js";
import { verdictOf, headlineOf, ENGINE_VERSION } from "../engine.js";
import { explorerAccountUrl } from "../networks.js";
import { wellKnown } from "../known.js";
import { withTimeout } from "../time.js";
import { f, short } from "../rules/util.js";
import { r03AccountState } from "../rules/r03-account-state.js";
import { r07Lookalike } from "../rules/r07-lookalike.js";
import { r14ReportedScam } from "../rules/r14-reported-scam.js";
import { r15FakeLetters } from "../rules/r15-fake-letters.js";
import { r17DisguisedName } from "../rules/r17-disguised-name.js";
import { r23Contacts } from "../rules/r23-contacts.js";
import { judgeDailySpend, unpricedSpend } from "../rules/r21-daily-spend.js";
import type { RuleResult } from "../rules/util.js";
import { TX_NOT_CHECKED, VERDICT_TEXT } from "../text.js";
import { HEADLINE_ORDER } from "../rules/index.js";
import type { TxAction, TxRequest } from "./decode.js";
import { parseTxRequest, type ParsedRequest } from "./input.js";
import { amountAndCollectorFindings } from "./history-checks.js";
import { minOutFindings } from "./min-out.js";
import { txPreview } from "./preview.js";
import { depositTxFindings } from "./deposit.js";
import { txInstructionFindings } from "./instructions.js";
import { nearSpend } from "./spend.js";

/*
 * Checks a transaction request before you approve it in your wallet. Read-only: nothing is signed
 * or sent. Four things, in plain words:
 *   T1  asks for FULL ACCESS to your account (AddKey full access, or a full-access sign-in)
 *   T2  calls a brand-new contract with little history, or one linked to drained wallets (R18)
 *   T3  sends your whole token (or NEAR) balance to an account Gideon hasn't seen before
 *   T4  lets an account Gideon hasn't seen before move your NFT (nft_approve, nft_transfer_call)
 *   T5  removes a key (DeleteKey): an app key is fine; a full-access key needs a second look; your
 *       last full-access key is blocked (it would lock you out). Read from the account's live keys.
 *   T6  other actions that can cost you the account or its funds: DeleteAccount (blocked unless the
 *       money goes to your own account or a contact), DeployContract (blocked), Stake (attention),
 *       and a large deposit attached to a contract call.
 *   T7  a swap or bridge whose minimum received is far below the amount going in (look again).
 *   T8  an Intents or bridge deposit on the wrong chain, for the wrong token, or past its deadline
 *       (blocked). A lookup that fails, or a deposit 1Click doesn't know, is look again.
 *   R19 a send much larger than this account's recent sends (look again).
 *   R20 a recipient whose public history looks like a collector, unless it is a known exchange.
 * Every account the request sends to, calls, or names as a beneficiary also gets the address
 * checks (R3 exists, R7 lookalike, R14 reported scam, R15 fake letters, R17 disguised name).
 * False positives stay low: well-known contracts, your contacts and accounts you've sent to are
 * never "new"; a contract is only "new" when it's under 30 days old AND has under 1,000
 * transactions; "whole balance" means 90% or more of a balance leaving in one request, summed over
 * every account Gideon hasn't seen.
 * Never green without at least one live lookup that answered (a plain sign-in, which carries no
 * transaction, is the only exception: there's nothing to look up).
 */

export const NEW_CONTRACT_DAYS = 30;
export const LOW_HISTORY_TXS = 1000;
export const WHOLE_BALANCE_SHARE = 0.9;
/** A deposit attached to a contract call at or above this many NEAR always gets a second look. */
export const LARGE_DEPOSIT_NEAR = 100;
/** Accounts in one request that get the full address checks (R3/R7/R14/R15/R17). */
export const MAX_CHECKED_ACCOUNTS = 6;
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
  // 0.3.1 (approved wording)
  deleteAccount: (b: string) => `This DELETES your account and sends everything in it to ${b}.`,
  deleteAccountDetail: "Only approve if you meant to close this account.",
  deployContract: "This replaces the code on your account.",
  deployContractDetail: "Code can move all your funds. Approve only if you wrote or fully trust it.",
  largeDeposit: (amount: string, contract: string) => `This sends ${amount} NEAR to ${contract} along with the call.`,
  // 0.3.1 (new, awaiting approval)
  stake: (amount: string) => `This stakes ${amount} NEAR from your account directly.`,
  stakeDetail: "Most people stake through a staking pool, not like this. Approve only if you run a validator and meant to.",
  noSigner: "Couldn't check: how much of your balance this sends",
  noSignerDetail: "Gideon couldn't tell which account signs this, so it couldn't compare the amount with your balance. Check the amount in your wallet.",
  balanceUnknown: "A data source didn't answer, so Gideon couldn't read your balance. Gideon won't call this request safe until it can check. Try again in a minute.",
  drainerUnknown: (a: string) => `Couldn't check: whether ${a} is linked to hacked wallets`,
  drainerUnknownDetail: "The transaction history Gideon uses for this check didn't answer in time. Gideon won't call this request safe until it can check. Try again in a minute.",
  tooManyAccounts: (n: number) => `Couldn't check ${n} more account${n === 1 ? "" : "s"} in this request`,
  tooManyAccountsDetail: `Gideon checks up to ${MAX_CHECKED_ACCOUNTS} accounts per request. Check the others in your wallet.`,
  // 0.3.2
  mixedSigners: "This request signs as more than one account",
  mixedSignersDetail: "A normal request signs for one account. Check every account and amount in your wallet before you approve.",
  contractKey: (c: string) => `This adds a key that can move what you hold in ${c}.`,
  contractKeyDetail: "Anyone with this key can move those funds. Approve only if you're setting up a wallet or device you own.",
  selfAppKey: "This adds a key that can call your own account's code.",
  shareNotChecked: (kind: string) => `Couldn't check: how much of your ${kind} balance this sends`,
  shareNotCheckedDetail: (c: string) => `Gideon can't read balances held inside ${c}, so it didn't compare this amount with what you hold there. Check the amount in your wallet.`,
  emptyRequest: "Gideon couldn't read this request",
  emptyRequestDetail: "It has a transaction with no actions in it, which no normal app sends. Don't approve it; go back and start again from the app.",
  selfAppKeyDetail: "If your account runs a contract (a multisig or lockup, for example), this key may be able to move funds. Approve only if you meant to.",
} as const;

export { wellKnown };

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
  /** Sends from this device kept per network (the extension): only the request's network counts. Used instead of deviceSends. */
  deviceSendsByNetwork?: Partial<Record<Network, string[]>>;
  /** The site asking, when known (the extension passes the page or callback host). */
  origin?: string;
  /** Chain the sender believes a deposit in this request pays out on (T8). */
  bridgeChain?: string;
  /** Daily NEAR cap for the signer (R21). Absent means this request has no cap. */
  dailyLimit?: string;
  /** NEAR already counted against that cap today. */
  spentToday?: string;
  /**
   * The request was read off the wallet's screen (Meteor), not decoded: Gideon knows who it's from
   * and to, not what it does. Never green.
   */
  screenOnly?: boolean;
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
  /**
   * Plain "you send / you receive / you approve" lines when the args can be read.
   * Empty when they can't. Not a verdict.
   */
  preview?: string[];
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

/**
 * Sources that count every lookup that answered (null included: "no such account" is an answer).
 * A request is only green when at least one did.
 */
function counted(sources: Sources, onAnswer: () => void): Sources {
  return new Proxy(sources, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        const out = v.apply(t, args);
        if (out && typeof (out as Promise<unknown>).then === "function") {
          return (out as Promise<unknown>).then((x) => { onAnswer(); return x; });
        }
        onAnswer();
        return out;
      };
    },
  });
}

/** Calls that move tokens held inside a contract (intents.near mt_*, a lockup's transfer). */
const MOVES_HELD = /^(mt_(batch_)?transfer(_call)?|transfer)$/;

const nearKind = (a: string) => ["near-named", "near-implicit", "eth-implicit"].includes(classify(a).kind);

export async function checkTransaction(input: TxCheckInput, rawSources: Sources, opts: TxCheckOptions = {}): Promise<TxCheckResult> {
  const t0 = Date.now();
  let answered = 0;
  const sources = counted(rawSources, () => { answered++; });
  const now = opts.now ?? Date.now();
  const parsed = parseTxRequest(input.request);
  const network = inferNetwork(parsed, input);
  const txs = parsed.transactions.map((t) => (t.signerId || !input.signerId ? t : { ...t, signerId: input.signerId.trim().toLowerCase() }));
  const signer = txs.find((t) => t.signerId)?.signerId;
  const origin = input.origin ?? parsed.site;
  const timeout = opts.sourceTimeoutMs ?? 10_000;
  const ask = <T>(p: () => Promise<T>) => withTimeout(Promise.resolve().then(p), timeout, "A lookup");

  // Only signers the request itself names are "yours". `input.signerId` is an assumption (often read
  // off the page), so it never makes an account trusted. A request that names more than one signer
  // trusts none of them: otherwise an attacker's own transaction in the batch would make their
  // account "yours", and a send to it would skip every check.
  const named = [...new Set(parsed.transactions.map((t) => (t.signerId ?? "").trim().toLowerCase()).filter(Boolean))];
  // The same goes for a signer that isn't the account you said signs (MCP `signer`, the extension's page account).
  const guess = input.signerId?.trim().toLowerCase();
  const trustNamed = named.length === 1 && (!guess || guess === named[0]);
  const mine = new Set([...(input.myAccounts ?? []).map((x) => x.trim().toLowerCase()), ...(trustNamed ? named : [])].filter(Boolean));
  const deviceSends = input.deviceSendsByNetwork ? (input.deviceSendsByNetwork[network] ?? []) : input.deviceSends;
  const known = new Set([...(input.addressBook ?? []).map((c) => c.account), ...(deviceSends ?? [])].map((x) => x.trim().toLowerCase()));
  const seen = (a: string) => mine.has(a) || known.has(a) || wellKnown(network, a);

  const findings: Finding[] = [];
  const acctEv = (label: string, a: string): Evidence => ({ label, value: a, url: explorerAccountUrl(network, a) });
  const contacts = new Set((input.addressBook ?? []).map((c) => c.account.trim().toLowerCase()));
  const confirmedMine = new Set((input.myAccounts ?? []).map((x) => x.trim().toLowerCase()));
  // One lookup context per account, shared by the address checks and the contract-age check.
  const ctxs = new Map<string, ReturnType<typeof makeCtx>>();
  const ctxFor = (a: string) => {
    let c = ctxs.get(a);
    if (!c) {
      c = makeCtx({ to: a, network, asset: { symbol: "NEAR" }, destination: "unknown",
        ...(input.addressBook ? { addressBook: input.addressBook } : {}), ...(deviceSends ? { deviceSends } : {}) },
      classify(a), sources, now, null, { sourceTimeoutMs: timeout, optionalBudgetMs: timeout });
      ctxs.set(a, c);
    }
    return c;
  };
  // The signer's account, looked up once (also the balance for T3).
  const signerAccounts = new Map<string, Promise<Awaited<ReturnType<Sources["viewAccount"]>>>>();
  const viewSigner = (a: string) => {
    let p = signerAccounts.get(a);
    if (!p) { p = ask(() => sources.viewAccount(network, a)); signerAccounts.set(a, p); p.catch(() => {}); }
    return p;
  };

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
  /** Value leaving with no known signer: the balance can't be compared. */
  const unsigned: string[] = [];
  /** Accounts that get the address checks, and what they are in this request. */
  /** "named": an account a contract call names as receiver_id (e.g. mt_transfer); it may live only inside that contract, so it needn't exist on chain. */
  type Role = "recipient" | "contract" | "beneficiary" | "named";
  const targets = new Map<string, Role>();
  const target = (a: string | undefined, role: Role) => {
    const x = a?.trim().toLowerCase();
    if (!x || mine.has(x) || wellKnown(network, x)) return;
    const prev = targets.get(x);
    // A recipient or beneficiary is checked as one (it must exist); a contract only needs to be real code.
    const weak = (r?: Role) => r === "contract" || r === "named";
    if (!prev || (weak(prev) && !(role === "contract" && prev === "named"))) targets.set(x, role);
  };
  const keyFindings: Finding[] = [];
  const shareNoted = new Set<string>();
  const nfts: { contract: string; tokenId: string; to: string; signer?: string; how: string }[] = [];
  for (const t of txs) {
    for (const a of t.actions) {
      if (a.type === "Transfer" && !mine.has(t.receiverId)) {
        target(t.receiverId, "recipient");
        if (BigInt(a.deposit) > 0n) {
          if (t.signerId) moves.push({ token: "NEAR", contract: null, to: t.receiverId, amount: BigInt(a.deposit), signer: t.signerId });
          else unsigned.push(t.receiverId);
        }
      }
      if (a.type === "DeleteAccount") target(a.beneficiaryId, "beneficiary");
      if (a.type === "AddKey" && !a.fullAccess && a.receiverId) {
        target(a.receiverId, "contract");
        // A key for the account's own code: on a multisig or lockup it may move funds.
        if (a.receiverId.trim().toLowerCase() === t.receiverId) {
          keyFindings.push(f("T1", "ATTENTION", "SELF_APP_KEY", TX_TEXT.selfAppKey, TX_TEXT.selfAppKeyDetail,
            { evidence: [acctEv("Account", t.receiverId), { label: "Key", value: short(a.publicKey, 16, 6) }] }));
        }
      }
      if (!ft(a)) continue;
      target(t.receiverId, "contract");
      // NEAR attached to a call leaves your account just like a transfer.
      if (/^\d+$/.test(a.deposit) && BigInt(a.deposit) > 0n && !mine.has(t.receiverId)) {
        if (t.signerId) moves.push({ token: "NEAR", contract: null, to: t.receiverId, amount: BigInt(a.deposit), signer: t.signerId });
        else unsigned.push(t.receiverId);
      }
      const to = argStr(a.args, "receiver_id")?.toLowerCase();
      if ((a.methodName === "ft_transfer" || a.methodName === "ft_transfer_call") && to) {
        target(to, "recipient");
        const amt = argStr(a.args, "amount");
        if (amt && /^\d+$/.test(amt) && BigInt(amt) > 0n) {
          if (t.signerId) moves.push({ token: t.receiverId, contract: t.receiverId, to, amount: BigInt(amt), signer: t.signerId });
          else unsigned.push(to);
        }
      }
      if (a.methodName === "nft_approve" || a.methodName === "nft_transfer_call" || a.methodName === "nft_transfer") {
        const who = (a.methodName === "nft_approve" ? argStr(a.args, "account_id") : to)?.toLowerCase();
        const tokenId = argStr(a.args, "token_id");
        if (who) target(who, "recipient");
        if (who && tokenId != null) nfts.push({ contract: t.receiverId, tokenId, to: who, ...(t.signerId ? { signer: t.signerId } : {}), how: a.methodName });
      } else if (to && a.methodName !== "ft_transfer" && a.methodName !== "ft_transfer_call") {
        // Any other call that names a receiver (mt_transfer on intents.near, a lockup's transfer, …):
        // the receiver gets the address and drained-wallet checks too.
        target(to, "named");
        if (!seen(to)) counterparts.add(to);
        // Tokens held inside the contract (intents, a lockup): Gideon has no balance to compare with.
        // Shown as not checked; the verdict is unchanged.
        if (MOVES_HELD.test(a.methodName) && !mine.has(to) && !shareNoted.has(t.receiverId)) {
          shareNoted.add(t.receiverId);
          findings.push(f("T3", "SKIPPED", TX_NOT_CHECKED, TX_TEXT.shareNotChecked(a.methodName.startsWith("mt_") ? "intents" : "lockup"), TX_TEXT.shareNotCheckedDetail(t.receiverId),
            { evidence: [acctEv("Contract", t.receiverId), acctEv("To", to)] }));
        }
      }
      // A contract-held key (intents.near add_public_key): it can move what you hold there.
      if (a.methodName === "add_public_key") {
        const key = argStr(a.args, "public_key");
        keyFindings.push(f("T1", "ATTENTION", "CONTRACT_KEY", TX_TEXT.contractKey(t.receiverId), TX_TEXT.contractKeyDetail,
          { evidence: [acctEv("Contract", t.receiverId), ...(key ? [{ label: "Key", value: short(key, 16, 6) }] : [])] }));
      }
    }
  }

  findings.push(...keyFindings);
  if (named.length > 1) {
    findings.push(f("T1", "ATTENTION", "MIXED_SIGNERS", TX_TEXT.mixedSigners, TX_TEXT.mixedSignersDetail,
      { evidence: named.map((a) => acctEv("Signer", a)) }));
  }
  const work: Promise<void>[] = [];

  // New contract: age (indexer, archival) and how many transactions it has.
  for (const c of called) {
    work.push((async () => {
      const ctx = ctxFor(c);
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

  // Whole balance leaving: everything one request sends from one account, per token, to accounts
  // Gideon hasn't seen, summed (so 49 + 49 to two strangers counts as 98).
  const groups = new Map<string, { signer: string; contract: string | null; byTo: Map<string, bigint> }>();
  for (const m of moves) {
    if (seen(m.to) || m.amount <= 0n) continue;
    counterparts.add(m.to);
    const k = `${m.signer}|${m.contract ?? ""}`;
    const g = groups.get(k) ?? { signer: m.signer, contract: m.contract, byTo: new Map<string, bigint>() };
    g.byTo.set(m.to, (g.byTo.get(m.to) ?? 0n) + m.amount);
    groups.set(k, g);
  }
  for (const g of groups.values()) {
    work.push((async () => {
      try {
        let balance: bigint | null;
        let symbol = "NEAR";
        let decimals = 24;
        if (g.contract) {
          const [bal, meta] = await Promise.all([
            // No balance source means Gideon can't compare: that's "couldn't check", never a pass.
            sources.ftBalance ? ask(() => sources.ftBalance!(network, g.contract!, g.signer)) : Promise.reject(new Error("no token balance source")),
            ask(() => sources.ftMetadata(network, g.contract!)).catch(() => null),
          ]);
          balance = bal == null ? null : BigInt(bal);
          symbol = meta?.symbol || short(g.contract, 14, 0);
          decimals = meta?.decimals ?? 0;
        } else {
          const acct = await viewSigner(g.signer);
          balance = acct ? BigInt(acct.amountYocto) : null;
        }
        if (balance == null || balance <= 0n) return;
        let tos = [...g.byTo.entries()];
        const total = () => tos.reduce((n, [, a]) => n + a, 0n);
        // amount / balance >= share, in integers.
        const whole = () => total() * 100n >= balance! * BigInt(Math.round(WHOLE_BALANCE_SHARE * 100));
        if (!whole()) return;
        if (!g.contract && sources.sentCount) {
          // Accounts this signer has paid before aren't "unseen".
          const before = await Promise.all(tos.map(([to]) => ask(() => sources.sentCount!(network, g.signer, to)).catch(() => 0)));
          tos = tos.filter((_, i) => !(before[i]! > 0));
          if (!tos.length || !whole()) return;
        }
        const names = tos.map(([to]) => to);
        const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
        findings.push(f("T3", "ATTENTION", "WHOLE_BALANCE_UNSEEN",
          `This sends your whole ${symbol} balance to ${list}, which Gideon hasn't seen before.`, "",
          { evidence: [
            { label: "Amount", value: `${fmtUnits(total(), decimals)} ${symbol}` },
            { label: "Your balance", value: `${fmtUnits(balance, decimals)} ${symbol}` },
            ...names.map((to) => acctEv("To", to)),
          ] }));
      } catch {
        findings.push(f("T3", "COULD_NOT_CHECK", "BALANCE_UNKNOWN", `Couldn't check: your ${g.contract ? short(g.contract, 14, 0) : "NEAR"} balance`,
          TX_TEXT.balanceUnknown));
      }
    })());
  }
  if (unsigned.some((a) => !seen(a.toLowerCase()))) {
    findings.push(f("T3", "COULD_NOT_CHECK", "BALANCE_NO_SIGNER", TX_TEXT.noSigner, TX_TEXT.noSignerDetail));
  }

  // T6: actions that can cost the whole account.
  for (const t of txs) {
    for (const a of t.actions) {
      if (a.type === "DeleteAccount") {
        const b = a.beneficiaryId.trim().toLowerCase();
        const ours = confirmedMine.has(b) || contacts.has(b);
        findings.push(f("T6", ours ? "ATTENTION" : "BLOCKED", ours ? "DELETE_ACCOUNT_TO_OWN" : "DELETE_ACCOUNT",
          TX_TEXT.deleteAccount(b), TX_TEXT.deleteAccountDetail,
          { evidence: [acctEv("Account", t.receiverId), acctEv("Everything goes to", b)] }));
      } else if (a.type === "DeployContract") {
        findings.push(f("T6", "BLOCKED", "DEPLOY_CONTRACT", TX_TEXT.deployContract, TX_TEXT.deployContractDetail,
          { evidence: [acctEv("Account", t.receiverId), { label: "Code size", value: `${a.codeBytes.toLocaleString("en-US")} bytes` }] }));
      } else if (a.type === "Stake" && /^\d+$/.test(a.stake) && BigInt(a.stake) > 0n) {
        findings.push(f("T6", "ATTENTION", "STAKE", TX_TEXT.stake(fmtUnits(BigInt(a.stake), 24)), TX_TEXT.stakeDetail,
          { evidence: [acctEv("Account", t.receiverId), { label: "Validator key", value: short(a.publicKey, 16, 6) }] }));
      } else if (ft(a) && /^\d+$/.test(a.deposit) && BigInt(a.deposit) >= BigInt(LARGE_DEPOSIT_NEAR) * 10n ** 24n) {
        findings.push(f("T6", "ATTENTION", "LARGE_DEPOSIT", TX_TEXT.largeDeposit(fmtUnits(BigInt(a.deposit), 24), t.receiverId), "",
          { evidence: [acctEv("Contract", t.receiverId), { label: "Method", value: a.methodName || "?" }] }));
      }
    }
  }

  // The address checks on every account this sends to, calls, or names as beneficiary.
  const toCheck = [...targets.entries()].filter(([a]) => nearKind(a) || classify(a).kind === "hex64-uppercase" || /[^\x20-\x7e]/.test(a));
  for (const [a, role] of toCheck.slice(0, MAX_CHECKED_ACCOUNTS)) {
    work.push((async () => {
      const ctx = ctxFor(a);
      const rules: [string, (c: typeof ctx) => RuleResult | Promise<RuleResult>][] = [
        ["R14", r14ReportedScam], ["R15", r15FakeLetters], ["R17", r17DisguisedName], ["R23", r23Contacts], ["R7", r07Lookalike], ["R3", r03AccountState],
      ];
      const out = (await Promise.all(rules.map(async ([, run]) => {
        try {
          const r = await run(ctx);
          return r == null ? [] : Array.isArray(r) ? r : [r];
        } catch {
          return [f("R3", "COULD_NOT_CHECK", "RULE_ERROR", `Couldn't check: ${a}`,
            "A data source answered with something Gideon couldn't read, so this check didn't finish. Gideon won't call this request safe until it can check. Try again in a minute.")];
        }
      }))).flat();
      for (const x of out) {
        if (x.status === "PASS" || x.status === "SKIPPED") continue;
        // Calling an account with no code does nothing (the call fails), and T2 reports lookups that failed.
        if ((role === "contract" || role === "named") && x.rule === "R3") continue;
        const ev = x.evidence ?? [];
        findings.push({
          ...x,
          detail: x.detail.replace(/\bYou pasted\b/g, "This request uses"),
          evidence: [
            ...(ev.some((e) => e.value === a) ? [] : [acctEv(role === "contract" ? "Contract" : role === "beneficiary" ? "Beneficiary" : "To", a)]),
            ...ev.map((e) => (e.label === "You pasted" ? { ...e, label: "In this request" } : e)),
          ],
        });
      }
    })());
  }
  if (toCheck.length > MAX_CHECKED_ACCOUNTS) {
    const n = toCheck.length - MAX_CHECKED_ACCOUNTS;
    findings.push(f("T1", "COULD_NOT_CHECK", "TOO_MANY_ACCOUNTS", TX_TEXT.tooManyAccounts(n), TX_TEXT.tooManyAccountsDetail,
      { evidence: toCheck.slice(MAX_CHECKED_ACCOUNTS).map(([a]) => ({ label: "Not checked", value: a })) }));
  }
  // Always look up the signer: proves the request names a real account, and is the live lookup a
  // request with nothing else to look up relies on.
  if (signer && nearKind(signer)) work.push(viewSigner(signer).then(() => {}, () => {}));

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

  // Drained-wallet links (R18), for called contracts and accounts receiving value or control. At most
  // MAX_CHECKED_ACCOUNTS; the rest are shown as "couldn't check", never dropped.
  const beneficiaries = [...targets.entries()].filter(([, r]) => r === "beneficiary").map(([a]) => a);
  const allDrain = [...new Set([...called, ...counterparts, ...beneficiaries])].filter(nearKind);
  const drainTargets = allDrain.slice(0, MAX_CHECKED_ACCOUNTS);
  for (const d of allDrain.slice(MAX_CHECKED_ACCOUNTS)) {
    findings.push(f("T2", "COULD_NOT_CHECK", "DRAINER_UNKNOWN", TX_TEXT.drainerUnknown(d), TX_TEXT.tooManyAccountsDetail, { evidence: [acctEv("Account", d)] }));
  }
  for (const d of drainTargets) {
    work.push((async () => {
      const x = await drainerCheck({ to: d, network, ...(signer && mine.has(signer) ? { from: signer } : {}), ...(input.addressBook ? { addressBook: input.addressBook } : {}), myAccounts: [...mine] },
        sources, { timeoutMs: opts.drainerTimeoutMs ?? 8000 }, opts.drainerCache);
      if (x.status === "SKIPPED" && x.code === "FAILED") {
        // A failed check is shown, never silent: Gideon didn't look, so it can't say "nothing found".
        findings.push(f("T2", "COULD_NOT_CHECK", "DRAINER_UNKNOWN", TX_TEXT.drainerUnknown(d), TX_TEXT.drainerUnknownDetail,
          { evidence: [acctEv("Account", d)] }));
        return;
      }
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

  findings.push(...minOutFindings(network, txs));
  findings.push(...txInstructionFindings(txs));
  if (input.dailyLimit?.trim()) {
    const spent = nearSpend(txs);
    if (spent.near) {
      findings.push(judgeDailySpend({
        limit: input.dailyLimit,
        ...(input.spentToday != null ? { spent: input.spentToday } : {}),
        amount: spent.near,
        ...(signer ? { from: signer } : {}),
      }));
    }
    if (spent.unpriced) findings.push(unpricedSpend());
  }
  work.push(depositTxFindings(network, txs, now, (addr) => ask(() => sources.oneClickStatus(addr)), input.bridgeChain)
    .then((more) => { findings.push(...more); }));
  // History lookups must not count as the live check that turns a request green.
  work.push(amountAndCollectorFindings(network, txs, rawSources, ask).then((more) => { findings.push(...more); }, () => {
    findings.push(f("R19", "COULD_NOT_CHECK", "AMOUNT_HISTORY_FAILED",
      "Couldn't check: whether this is more than you usually send",
      "The send-history lookup failed. This amount isn't called normal."));
  }));

  await Promise.all(work);

  if (txs.some((t) => t.partial)) {
    findings.push(f("T1", "COULD_NOT_CHECK", "UNREADABLE_ACTION", "Couldn't read all of this request",
      "Part of it uses an action Gideon can't read yet, so it may do more than is shown here. Check it carefully in your wallet."));
  }
  // A transaction with no actions: nothing a normal app sends, and nothing Gideon can vouch for.
  if (txs.some((t) => !t.partial && t.actions.length === 0)) {
    findings.push(f("T1", "COULD_NOT_CHECK", "EMPTY_REQUEST", TX_TEXT.emptyRequest, TX_TEXT.emptyRequestDetail));
  }
  // Read off the wallet's screen (Meteor) or a placeholder with no method: what it does is unknown.
  if (input.screenOnly || txs.some((t) => t.actions.some((a) => ft(a) && !a.methodName))) {
    findings.push(f("T1", "COULD_NOT_CHECK", "SCREEN_ONLY", VERDICT_TEXT.screenOnlyTitle, VERDICT_TEXT.screenOnlyBody));
  }
  const plainSignIn = !txs.length && !parsed.signIn;
  if (plainSignIn) {
    findings.push(f("T1", "PASS", "PLAIN_SIGN_IN", "Normal sign-in: no full-access key", "This sign-in doesn't ask for a full-access key."));
  }
  if (verdictOf(findings) === "SAFE") {
    if (!plainSignIn && answered === 0) {
      // Every lookup failed (or there was none): that is never a green.
      findings.push(f("T1", "COULD_NOT_CHECK", "NOT_CHECKED_LIVE", "Gideon couldn't finish checking this request.",
        VERDICT_TEXT.cantCheckBody.replace(/^Gideon couldn't finish checking this request\. /, "")));
    } else if (!findings.some((x) => x.status === "PASS" && x.rule.startsWith("T"))) {
      findings.push(f("T1", "PASS", "NOTHING_FOUND", VERDICT_TEXT.txSafeTitle, VERDICT_TEXT.txSafeBody));
    }
  }

  // Stable order: blocked first, then rule, then title.
  const rank = { BLOCKED: 0, ATTENTION: 1, COULD_NOT_CHECK: 2, PASS: 3, SKIPPED: 4 } as const;
  const order = (x: Finding) => HEADLINE_ORDER.indexOf(x.rule);
  findings.sort((a, b) => rank[a.status] - rank[b.status] || order(a) - order(b) || a.title.localeCompare(b.title));
  const verdict = verdictOf(findings);
  const headline = headlineOf(findings, verdict)
    ?? findings.find((x) => x.status === "PASS" && x.rule.startsWith("T")) ?? findings[0] ?? null;
  return {
    engine: ENGINE_VERSION, kind: "transaction", network, verdict, headline, findings,
    transactions: txs, ...(parsed.signIn ? { signIn: parsed.signIn } : {}), ...(signer ? { signer } : {}), ...(origin ? { origin } : {}),
    source: parsed.source, preview: txPreview(network, txs), checkedAt: new Date(now).toISOString(), ms: Date.now() - t0,
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

/**
 * The answer when the check itself didn't finish (the extension's worker didn't reply, or every
 * lookup failed): the approved COULDN'T CHECK card. Never SAFE.
 */
export function unfinishedRequest(o: { network?: Network; now?: number } = {}): TxCheckResult {
  const now = o.now ?? Date.now();
  const finding = f("T1", "COULD_NOT_CHECK", "NOT_CHECKED_LIVE", "Gideon couldn't finish checking this request.",
    VERDICT_TEXT.cantCheckBody.replace(/^Gideon couldn't finish checking this request\. /, ""));
  return {
    engine: ENGINE_VERSION, kind: "transaction", network: o.network ?? "mainnet", verdict: "ATTENTION", headline: finding, findings: [finding],
    transactions: [], source: "sign-link", checkedAt: new Date(now).toISOString(), ms: 0,
  };
}
