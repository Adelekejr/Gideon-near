import { classify } from "./classify.js";
import { headlineOf, verdictOf } from "./engine.js";
import { explorerTxUrl } from "./networks.js";
import { makeReceipt } from "./receipt.js";
import { withTimeout } from "./time.js";
import type { AccountInfo, ChainTx, CheckResult, Contact, Finding, Network, Sources } from "./types.js";
import { isExchangeAccount } from "./exchange-accounts.js";
import { f, short } from "./rules/util.js";

/**
 * R18 — drained wallets swept into this address. A wallet drainer that got someone's seed phrase
 * adds its own full-access key, then uses that new key straight away to send everything to its
 * collector account. Gideon looks at the newest accounts that sent NEAR to the recipient. A sender
 * counts as drained only when all three hold:
 *  1. a new full-access key was added (by a different key) shortly before the transfer,
 *  2. the transfer was the first thing that new key signed,
 *  3. the sender is now left with almost nothing (under 0.1 NEAR) or was deleted.
 * Two or more drained senders → BLOCKED; one → ATTENTION. Exchanges and busy services are skipped.
 *
 * It needs several lookups, so it runs after the main check and never holds it up: surfaces show
 * the verdict first and update it when this answers (withDrainer). A failure or time-out is
 * SKIPPED with code FAILED: it never makes a send look worse or better, but every surface shows it
 * as "not checked" (0.3.1).
 */

export interface DrainerInput {
  to: string;
  network: Network;
  from?: string;
  addressBook?: Contact[];
  /** Your own accounts (never checked). */
  myAccounts?: string[];
}

export interface DrainerOptions {
  /** Whole-check time limit. Default 8 s. */
  timeoutMs?: number;
  /** How many of the newest distinct senders to look at. Default 5. */
  senders?: number;
  /** How long before the transfer the new key may have been added. Default 60 min. */
  windowMs?: number;
}

export const DRAINER_DEFAULTS = { timeoutMs: 8000, senders: 5, windowMs: 60 * 60_000 };
/** "Left with almost nothing": under 0.1 NEAR. */
const DUST_YOCTO = 10n ** 23n;
/** A recipient this rich or this busy is an exchange or a big service: its senders say nothing about it. */
const BUSY_BALANCE_YOCTO = 100_000n * 10n ** 24n;
const BUSY_INBOUND_TXS = 50_000;
const HOW_MANY_INBOUND = 40;
// Room to see past a drainer deleting dozens of keys before sweeping (dolbabob.near's victims did 30 to 500).
const SIGNED_FIRST = 20;
const SIGNED_MORE = 40;

export interface DrainedSender {
  account: string;
  /** The transfer into the recipient. */
  tx: string;
  minutesAfterKey: number;
  /** The new key removed the owner's other keys before sending here. */
  deletedOldKeys?: true;
  /** A key not used before (not one added minutes ago) removed the owner's keys, then sent here. */
  takeover?: { keysRemoved: number; atLeast: boolean };
  /** Sender balance now, in NEAR (null = account deleted). */
  leftNear: string | null;
}

const skip = (code: string, detail: string): Finding => ({ ...f("R18", "SKIPPED", code, "Drained-wallet check didn't run", detail) });

function nearStr(yocto: bigint): string {
  const n = Number(yocto / 10n ** 18n) / 1e6;
  return n < 0.01 ? (n === 0 ? "0" : "<0.01") : n.toFixed(2).replace(/\.?0+$/, "");
}

export interface DrainSign { minutesAfterKey: number; deletedOldKeys?: true; takeover?: { keysRemoved: number; atLeast: boolean } }

/**
 * Did this sender look drained by the transfer `t` into the recipient? Either:
 * - new key: a full-access key added by a different key minutes before, whose first use was this
 *   send (or deleting the owner's other keys, then this send); or
 * - takeover: a key that hadn't signed anything before (or not for at least the window) wakes up,
 *   deletes two or more of the owner's other keys and sends here, all within the window.
 * In both, the account is left with under 0.1 NEAR (or deleted).
 */
export function drainedBy(t: ChainTx, history: ChainTx[], now: AccountInfo | null, windowMs: number): DrainSign | null {
  if (now && BigInt(now.amountYocto) >= DUST_YOCTO) return null;
  const before = history.filter((x) => x.hash !== t.hash && (x.blockHeight < t.blockHeight || (x.blockHeight === t.blockHeight && x.timestampMs <= t.timestampMs)));
  const key = t.signerKey;
  // Newest first: the key's addition is the newest earlier tx that added it.
  const add = [...before].sort((a, b) => b.timestampMs - a.timestampMs)
    .find((x) => x.actions.some((a) => a.kind === "addKey" && a.publicKey === key && a.fullAccess));
  if (add && add.signerKey === key) return null;
  const used = before.filter((x) => x.signerKey === key && x.hash !== add?.hash);
  const deletes = (x: ChainTx) => x.signer === t.signer && x.actions.length > 0 && x.actions.every((a) => a.kind === "deleteKey" && a.publicKey !== key);
  const mins = (ms: number) => Math.max(0, Math.round(ms / 60_000));

  if (add) {
    const gap = t.timestampMs - add.timestampMs;
    if (gap >= 0 && gap <= windowMs) {
      const between = used.filter((x) => x.timestampMs >= add.timestampMs);
      if (between.every(deletes)) return { minutesAfterKey: mins(gap), ...(between.length ? { deletedOldKeys: true as const } : {}) };
    }
  }

  // Takeover by a dormant key.
  const recent = used.filter((x) => t.timestampMs - x.timestampMs <= windowMs);
  if (!recent.length || recent.length !== used.length) return null;
  if (!recent.every((x) => deletes(x) || (x.signer === t.signer && isTransferOnly(x)))) return null;
  const gone = new Set(recent.flatMap((x) => x.actions.flatMap((a) => (a.kind === "deleteKey" ? [a.publicKey] : []))));
  if (gone.size < 2) return null;
  // If everything fetched is this burst, the key's older use can't be seen: then only a big
  // lock-out (ten or more keys removed) counts.
  const oldest = Math.min(...before.map((x) => x.timestampMs));
  if (!add && t.timestampMs - oldest <= windowMs && gone.size < 10) return null;
  const first = Math.min(...recent.map((x) => x.timestampMs));
  return { minutesAfterKey: mins(t.timestampMs - first), deletedOldKeys: true, takeover: { keysRemoved: gone.size, atLeast: !add } };
}

const isTransferOnly = (t: ChainTx) => t.actions.length > 0 && t.actions.every((a) => a.kind === "transfer");

export async function drainerCheck(input: DrainerInput, sources: Sources, opts: DrainerOptions = {}, cache?: DrainerCache): Promise<Finding> {
  const pre = drainerPrecheck(input, sources);
  if (pre) return pre;
  const o = { ...DRAINER_DEFAULTS, ...opts };
  const to = classify(input.to).normalized;
  const timed = async () => {
    try {
      return await withTimeout(run(to, input.network, sources, o), o.timeoutMs, "The drained-wallet check");
    } catch (e) {
      return skip("FAILED", `Couldn't finish (${e instanceof Error ? e.message : String(e)}). This says nothing about the address.`);
    }
  };
  return cache ? cache.get({ ...input, to }, timed) : timed();
}

/**
 * The quick, offline reasons not to look (checked before any cache, so adding a contact or
 * switching accounts takes effect at once). Null means: go and look.
 */
export function drainerPrecheck(input: DrainerInput, sources: Sources): Finding | null {
  const c = classify(input.to ?? "");
  if (!["near-named", "near-implicit", "eth-implicit"].includes(c.kind)) return skip("NOT_APPLICABLE", "Not a NEAR account.");
  const to = c.normalized;
  const mine = new Set([...(input.myAccounts ?? []), ...(input.from ? [input.from] : [])].map((x) => x.trim().toLowerCase()));
  if (mine.has(to)) return skip("OWN_ACCOUNT", "This is one of your own accounts.");
  if ((input.addressBook ?? []).some((x) => x.account.trim().toLowerCase() === to)) return skip("CONTACT", "This account is in your address book.");
  if (!sources.inboundTxs || !sources.signedTxsUpTo) return skip("UNAVAILABLE", "No transaction source for this check.");
  if (isExchangeAccount(input.network, to)) return skip("BUSY_ACCOUNT", "This is a known exchange wallet. Deposit sweeps can look like drains, so this check doesn't call it a drainer. Per-user deposit addresses are not all listed.");
  return null;
}

async function run(to: string, network: Network, sources: Sources, o: typeof DRAINER_DEFAULTS): Promise<Finding> {
  const [acct, inbound] = await Promise.all([sources.viewAccount(network, to), sources.inboundTxs!(network, to, HOW_MANY_INBOUND)]);
  if (!acct) return skip("NO_ACCOUNT", "The account doesn't exist.");
  if (BigInt(acct.amountYocto) > BUSY_BALANCE_YOCTO || inbound.total > BUSY_INBOUND_TXS) return skip("BUSY_ACCOUNT", "This looks like an exchange or busy service: its senders don't say much about it.");
  const picked: ChainTx[] = [];
  for (const t of inbound.txs) {
    if (picked.length >= o.senders) break;
    if (t.receiver !== to || t.signer === to || !isTransferOnly(t) || picked.some((p) => p.signer === t.signer)) continue;
    picked.push(t);
  }
  if (!picked.length) return f("R18", "PASS", "NO_SENDERS", "No recent NEAR transfers to look at", "Nobody has sent plain NEAR to this account recently, so there were no senders to check.");
  const checked = await Promise.all(picked.map(async (t) => {
    // Balance first: a sender that still holds NEAR wasn't drained, so its history isn't read.
    const now = await sources.viewAccount(network, t.signer);
    if (now && BigInt(now.amountYocto) >= DUST_YOCTO) return { t, now, d: null };
    let hist = await sources.signedTxsUpTo!(network, t.signer, t.blockHeight, SIGNED_FIRST);
    // All of it signed by the sending key and no key addition in sight: read further back once.
    if (hist.length >= SIGNED_FIRST && hist.every((x) => x.signerKey === t.signerKey)) {
      const low = Math.min(...hist.map((x) => x.blockHeight));
      hist = [...hist, ...(await sources.signedTxsUpTo!(network, t.signer, low - 1, SIGNED_MORE))];
    }
    const d = drainedBy(t, hist, now, o.windowMs);
    return { t, now, d };
  }));
  const hits: DrainedSender[] = checked.filter((x) => x.d).map((x) => ({
    account: x.t.signer, tx: x.t.hash, minutesAfterKey: x.d!.minutesAfterKey, ...(x.d!.deletedOldKeys ? { deletedOldKeys: true as const } : {}), ...(x.d!.takeover ? { takeover: x.d!.takeover } : {}), leftNear: x.now ? nearStr(BigInt(x.now.amountYocto)) : null,
  }));
  // Exchange deposit sweeps leave every deposit account with the same tiny balance (e.g. all 0.0675 NEAR).
  const bal = new Map<string, number>();
  for (const x of checked) if (x.now && BigInt(x.now.amountYocto) < DUST_YOCTO) bal.set(x.now.amountYocto, (bal.get(x.now.amountYocto) ?? 0) + 1);
  if (hits.length < 2 && Math.max(0, ...bal.values()) >= 4) return skip("BUSY_ACCOUNT", "Its senders all look like an exchange's deposit accounts.");
  return verdictFinding(hits, picked.length, network);
}

function evidenceOf(h: DrainedSender, network: Network) {
  const left = h.leftNear === null ? "the account was then deleted" : `left with ${h.leftNear} NEAR`;
  const when = h.minutesAfterKey < 1 ? "under a minute" : `${h.minutesAfterKey} min`;
  const how = h.takeover
    ? (h.takeover.atLeast
      ? `a key it hadn't used before removed at least ${h.takeover.keysRemoved} of the owner's other keys, then sent here`
      : `a key it hadn't used before removed ${h.takeover.keysRemoved} of the owner's other keys, starting ${when} before it sent here`)
    : `new full-access key added ${when} before it sent here${h.deletedOldKeys ? "; it first removed the owner's other keys" : ""}`;
  return { label: short(h.account, 18, 10), value: `${how}; ${left}`, url: explorerTxUrl(network, h.tx) };
}

export function verdictFinding(hits: DrainedSender[], looked: number, network: Network): Finding {
  const n = hits.length;
  if (n >= 2) {
    return f("R18", "BLOCKED", "DRAINER_COLLECTOR", "Funds from hacked wallets were swept into this address",
      `${n} of the last ${looked} accounts that sent NEAR here look hacked: minutes before each send, someone took control of the account (added a new full-access key, or used a key it hadn't used before to remove the owner's other keys), sent its NEAR here, and left it nearly empty. That's how wallet drainers collect stolen funds.`,
      {
        fix: ["Don't send to this address.", "If you were asked to send here to “verify”, “unlock” or “migrate” a wallet, it's a scam.", "If you typed your seed phrase into a site or app, move what's left to a new wallet now."],
        evidence: [{ label: "Pattern", value: `${n} accounts were swept into this address minutes after someone took control of them` }, ...hits.map((h) => evidenceOf(h, network))],
      });
  }
  if (n === 1) {
    return f("R18", "ATTENTION", "DRAINED_SENDER", "Look again: a wallet that sent here looks hacked",
      `One of the last ${looked} accounts that sent NEAR here looks drained: minutes before, someone took control of it (a new full-access key, or a key it hadn't used before removing the owner's other keys), sent its NEAR here, and left it nearly empty. One case can be a coincidence, but wallet drainers collect funds this way.`,
      { fix: ["Check with the receiver that this is really their account before you send."], evidence: hits.map((h) => evidenceOf(h, network)) });
  }
  return f("R18", "PASS", "NO_DRAINED_SENDERS", "No sign of hacked wallets sending here",
    `Gideon looked at the last ${looked} ${looked === 1 ? "account" : "accounts"} that sent NEAR here and none looks drained. That doesn't vouch for the address.`);
}

/** Visible to people: blocked, look-again, or the all-clear line. SKIPPED (not run, failed, timed out) shows nothing. */
export const drainerShown = (x: Finding | null | undefined): x is Finding => !!x && x.rule === "R18" && x.status !== "SKIPPED";

/**
 * Put the R18 finding into a finished result: verdict, headline and receipt are recomputed.
 * A SKIPPED finding is still recorded (so the receipt says the check didn't run) but changes nothing else.
 */
export async function withDrainer(r: CheckResult, x: Finding, receiptKey?: string, call?: { ms: number; ok: boolean }): Promise<CheckResult> {
  const findings = [...r.findings.filter((y) => y.rule !== "R18"), x];
  const verdict = verdictOf(findings);
  const sources = call ? [...r.sources.filter((s) => s.source !== "R18:drained-wallets"), { source: "R18:drained-wallets", ok: call.ok, ms: call.ms, optional: true }] : r.sources;
  const { receipt: _old, ...rest } = r;
  const base = { ...rest, findings, verdict, headline: headlineOf(findings, verdict), sources };
  return { ...base, receipt: await makeReceipt(base, receiptKey) };
}

/**
 * Run the check and merge it, timing it into result.sources. A result that's already BLOCKED
 * isn't looked at again (the answer can't get stronger, and it saves the lookups).
 */
export async function checkDrainer(r: CheckResult, sources: Sources, extra: Pick<DrainerInput, "myAccounts"> & { cache?: DrainerCache; /** False when `from` is only a guess from the page (extension): then it never counts as your own account. Default true. */ trustFrom?: boolean } = {}, opts: DrainerOptions = {}, receiptKey?: string): Promise<CheckResult> {
  if (!drainerWanted(r)) return r;
  const t0 = Date.now();
  const x = await drainerCheck(drainerInputOf(r, extra.myAccounts, extra.trustFrom ?? true), sources, opts, extra.cache);
  return withDrainer(r, x, receiptKey, { ms: Date.now() - t0, ok: x.code !== "FAILED" });
}

/** Worth running: a NEAR recipient whose answer isn't already BLOCKED and that hasn't been looked at yet. */
export function drainerWanted(r: CheckResult): boolean {
  if (r.verdict === "BLOCKED" || r.findings.some((y) => y.rule === "R18")) return false;
  return ["near-named", "near-implicit", "eth-implicit"].includes(classify(r.input.to ?? "").kind);
}

export function drainerInputOf(r: CheckResult, myAccounts?: string[], trustFrom = true): DrainerInput {
  return {
    to: r.input.to, network: r.input.network,
    ...(r.input.from && trustFrom ? { from: r.input.from } : {}),
    ...(r.input.addressBook ? { addressBook: r.input.addressBook } : {}),
    ...(myAccounts?.length ? { myAccounts } : {}),
  };
}

/**
 * Remembers answers for a while, per network and recipient, so re-renders and repeat checks don't
 * ask again. Only real answers are kept (a failure, time-out or skip is asked again next time).
 */
export class DrainerCache {
  private m = new Map<string, { at: number; p: Promise<Finding> }>();
  constructor(private ttlMs = 10 * 60_000, private max = 200) {}
  get(input: DrainerInput, run: () => Promise<Finding>, now = Date.now()): Promise<Finding> {
    const k = `${input.network}|${input.to.trim().toLowerCase()}`;
    const hit = this.m.get(k);
    if (hit && now - hit.at < this.ttlMs) return hit.p;
    const p = run().then((x) => {
      if (x.status === "SKIPPED" && x.code !== "BUSY_ACCOUNT") this.m.delete(k);
      return x;
    });
    this.m.set(k, { at: now, p });
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value!);
    return p;
  }
}
