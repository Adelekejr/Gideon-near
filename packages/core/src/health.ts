import type { AccessKeyEntry, AccountInfo, ChainTx, KeyRecord, Network, SourceCall, Sources } from "./types.js";
import { classify } from "./classify.js";
import { fmtDate, makeCtx, yoctoToNear } from "./context.js";
import { DrainerCache, drainedBy, drainerCheck } from "./drainer.js";
import { ENGINE_VERSION } from "./engine.js";
import { explorerAccountUrl } from "./networks.js";
import { short } from "./rules/util.js";
import { LOW_HISTORY_TXS, NEW_CONTRACT_DAYS, wellKnown } from "./tx/check.js";
import { encodeTransaction, toBase64 } from "./tx/decode.js";
import { withTimeout } from "./time.js";

/**
 * Account health: who can act for this account. A read-only look at the account's access keys
 * (RPC view_access_key_list), when each was added (NearBlocks, FastNEAR history, or the block
 * height hidden in a new key's nonce) and what each key did (FastNEAR signed history).
 *
 * Red needs real evidence, so a normal account (one wallet key, a few app keys) is clean or amber:
 *  - a full-access key is "you may not know" only when
 *    (A) it removed 2 or more other full-access keys within an hour and sent funds out in that hour,
 *    (B) it moved funds out the way drained accounts do (R18's drainedBy: a new key added by another
 *        key, or a dormant key that removed keys, then a transfer, leaving under 0.1 NEAR), or
 *    (C) it was added in the last 14 days by another key of this account (or by an unknown signer on
 *        an account older than a day), and the account has 2 or more full-access keys;
 *  - an app key is red when its contract is new (under 30 days and under 1,000 transactions, like T2)
 *    or linked to drained wallets (R18 on the contract).
 *  - an app key whose contract is new or linked to drained wallets is a real concern (amber, LOOK AGAIN):
 *    an app key can't move NEAR, so it isn't red.
 * Tidy-up (0.3.0): an app key for any method, with no gas-fee limit, or unused for 6 months or more is
 * listed under "You can tidy these up". It isn't flagged and doesn't change a CLEAN result.
 * Old extra full-access keys are never flagged as "unused": one may be a seed-phrase backup.
 */

export const HEALTH_TEXT = {
  heading: "Account health: who can act for this account",
  clean: "No warning signs found.",
  attention: (n: number) => (n === 1 ? "1 key needs your attention." : `${n} keys need your attention.`),
  danger: "Danger: someone else may control this account.",
  unknownFull: (date: string | null) => `Full control key you may not know. ${date ? `Added ${date}.` : "Added: unknown."} Whoever holds it can move all your funds.`,
  riskyContract: (c: string) => `App key for a risky contract (${c}). It is new or linked to known drainers.`,
  anyMethod: (c: string) => `This app key can call any method on ${c}.`,
  noAllowance: "No spending limit on gas fees.",
  unused: (n: number) => `Not used in ${n} months; you can remove it.`,
  walletKey: "This may be the key your wallet uses. Removing it can sign you out or lock you out.",
  removeButton: "Remove key in my wallet",
  confirm: (shortKey: string) => `Your wallet will open and ask you to sign one change: delete this key. Gideon never sees your keys. Check the key shown in your wallet matches ${shortKey}.`,
  moveFunds: "Move your funds now. A full control key you don't recognise can empty this account, and it can delete your keys too. First send your tokens and NFTs to a new account you control. Then remove the unknown key.",
  footer: "Read-only check from public NEAR data. Gideon never holds keys or signs anything. Advice, not a guarantee.",
  // Beyond the approved text (listed in the 0.2.9 notes):
  notFound: (net: Network) => `This account doesn't exist on NEAR ${net}.`,
  couldNotCheck: "Couldn't read this account's keys. Try again in a minute.",
  addedUnknown: "Added: unknown",
  whyTakeover: (n: number) => `It removed ${n} other full control keys within an hour and sent funds out.`,
  whyDrain: (m: number) => `It sent funds out ${m === 0 ? "within a minute" : `${m} min`} after taking control, and the account was left nearly empty.`,
  whyRecent: (d: number) => `Added ${d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`} by another key of this account.`,
  noHistory: "Couldn't read this account's history, so some checks didn't run.",
  noKeyRecords: "Couldn't read this account's key records, so some checks didn't run.",
  lookupGap: "Some checks didn't run, so this isn't a clean result.",
  // Beyond the approved text, new in 0.3.0:
  tidyHeading: "You can tidy these up",
  tidyNote: "Not a risk. These keys let an app act for you. They cannot move your NEAR. Removing one signs you out of that app. You can clean them up when you like.",
  cleanTidy: (n: number) => `No warning signs found. ${n === 1 ? "1 key" : `${n} keys`} you can tidy up.`,
  riskyContractWhy: "An app key can't move your NEAR, but it can act for you in that app.",
} as const;

export const RECENT_FULL_KEY_DAYS = 14;
export const UNUSED_DAYS = 180;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const CONTRACT_CHECKS = 4;
const NONCE_DATE_LOOKUPS = 8;
const HISTORY_LIMIT = 200;

export type HealthStatus = "clean" | "attention" | "danger" | "not-found" | "could-not-check";

export interface KeyFlag {
  /** red = danger, amber = a real concern (LOOK AGAIN), tidy = optional clean-up (not flagged). */
  level: "red" | "amber" | "tidy";
  code: "UNKNOWN_FULL_KEY" | "RISKY_CONTRACT" | "ANY_METHOD" | "NO_ALLOWANCE" | "UNUSED";
  text: string;
  /** Why, in plain words (red flags). */
  why?: string;
}

export interface KeyReport {
  publicKey: string;
  kind: "full" | "app";
  /** App keys: the contract it may call, its methods ([] = any) and gas-fee allowance (null = no limit). */
  contract?: string;
  methods?: string[];
  allowanceYocto?: string | null;
  /** When it was added (ISO), or null when no source knows. */
  addedAt: string | null;
  addedFrom: "indexer" | "history" | "nonce" | null;
  /** The key that signed the add, when known (and the account that signed it). */
  addedByKey?: string;
  addedBySigner?: string;
  /** Times it signed (from its nonce), when readable. */
  uses: number | null;
  lastUsedAt: string | null;
  probableWalletKey: boolean;
  flags: KeyFlag[];
  /** The wallet can build a DeleteKey for this key type (ed25519, secp256k1). */
  removable: boolean;
  /** Only tidy-up notes (no red or amber flag). */
  tidy: boolean;
  /** Ready-to-sign removal (unsigned) for every removable key except the only full-access key. */
  remove?: RemoveKeyPlan;
}

/**
 * What this key can do, in one sentence. Same words on the website and in the extension.
 * An app key cannot move NEAR; removing it signs you out of that app.
 */
export function keyScopeText(k: Pick<KeyReport, "kind" | "contract" | "methods" | "allowanceYocto">): string {
  if (k.kind === "full") return "This key can move NEAR, tokens and NFTs, add or remove other keys, and delete the account.";
  const methods = k.methods && k.methods.length
    ? k.methods.slice(0, 4).join(", ") + (k.methods.length > 4 ? "…" : "")
    : "any method";
  const gas = k.allowanceYocto == null
    ? "Gas fees have no cap."
    : `Gas fees are capped at about ${yoctoToNear(k.allowanceYocto)} NEAR.`;
  return `Can call ${methods} on ${k.contract ?? "the app"}. It cannot move your NEAR by itself. Removing it signs you out of that app. ${gas}`;
}

export interface AccountHealthResult {
  engine: string;
  kind: "account-health";
  account: string;
  network: Network;
  status: HealthStatus;
  /** Any red flag (CLI exits 2). */
  red: boolean;
  summary: string;
  moveFundsNow: boolean;
  advice: string | null;
  keys: KeyReport[];
  /** flagged = keys with a red or amber flag; tidy = keys with only tidy-up notes. */
  counts: { full: number; app: number; flagged: number; tidy: number };
  notes: string[];
  sources: SourceCall[];
  explorerUrl: string;
  checkedAt: string;
  ms: number;
}

export interface AccountHealthInput {
  account: string;
  /** Default: from the name (.testnet / .near), else testnet. */
  network?: Network;
}

export interface AccountHealthOptions {
  now?: number;
  /** Per-lookup limit. Default 8 s. */
  sourceTimeoutMs?: number;
  /** Contract checks (age, drained-wallet) limit. Default 8 s. */
  contractTimeoutMs?: number;
  drainerCache?: DrainerCache;
  /** Wait before the one quiet retry of a failed key or history read. Default 1.5 s. */
  retryDelayMs?: number;
  /** Where the wallet returns after a removal (Meteor needs one). Default: the account on NearBlocks. */
  callbackUrl?: string;
}

export function healthNetwork(account: string, network?: Network): Network {
  if (network) return network;
  return account.trim().toLowerCase().endsWith(".near") ? "mainnet" : "testnet";
}

/** Nonce → (block height at the add, times used). Keys added before the rule have no height. */
export function readNonce(nonce: string): { addHeight: number | null; uses: number } {
  let n: bigint;
  try { n = BigInt(nonce); } catch { return { addHeight: null, uses: 0 }; }
  if (n < 1_000_000n) return { addHeight: null, uses: Number(n) };
  return { addHeight: Number(n / 1_000_000n), uses: Number(n % 1_000_000n) };
}

export async function accountHealth(input: AccountHealthInput, sources: Sources, opts: AccountHealthOptions = {}): Promise<AccountHealthResult> {
  const t0 = Date.now();
  const now = opts.now ?? Date.now();
  const c = classify(input.account);
  if (!["near-named", "near-implicit", "eth-implicit"].includes(c.kind)) throw new Error(`"${input.account.trim().slice(0, 80)}" isn't a NEAR account. Type one like alice.near or alice.testnet.`);
  const account = c.normalized;
  const network = healthNetwork(account, input.network);
  const timeout = opts.sourceTimeoutMs ?? 8000;
  const calls: SourceCall[] = [];
  const notes: string[] = [];
  const ask = async <T>(name: string, fn: () => Promise<T>, optional = true, ms = timeout): Promise<T> => {
    const s = Date.now();
    try {
      const v = await withTimeout(fn(), ms, name);
      calls.push({ source: name, ok: true, ms: Date.now() - s, ...(optional ? { optional } : {}) });
      return v;
    } catch (e) {
      calls.push({ source: name, ok: false, ms: Date.now() - s, error: e instanceof Error ? e.message : String(e), ...(optional ? { optional } : {}) });
      throw e;
    }
  };
  const base = (status: HealthStatus, summary: string): AccountHealthResult => ({
    engine: ENGINE_VERSION, kind: "account-health", account, network, status, red: false, summary, moveFundsNow: false, advice: null,
    keys: [], counts: { full: 0, app: 0, flagged: 0, tidy: 0 }, notes, sources: calls, explorerUrl: explorerAccountUrl(network, account),
    checkedAt: new Date(now).toISOString(), ms: Date.now() - t0,
  });

  // One quiet retry for the reads that matter most (keys, key records, history): public APIs blink.
  const wait = opts.retryDelayMs ?? 1500;
  const retry = <T>(name: string, fn: () => Promise<T>, optional = true): Promise<T> =>
    ask(name, fn, true).catch(() => new Promise<void>((r) => setTimeout(r, wait)).then(() => ask(`${name}:retry`, fn, optional)));

  if (!sources.accessKeys) return base("could-not-check", HEALTH_TEXT.couldNotCheck);
  const keysP = retry(`rpc:view_access_key_list:${account}`, () => sources.accessKeys!(network, account), false);
  const infoP = ask(`rpc:view_account:${account}`, () => sources.viewAccount(network, account)).catch(() => null);
  const recsP = sources.keyRecords ? retry(`nearblocks:keys:${account}`, () => sources.keyRecords!(network, account)).catch(() => null) : Promise.resolve(null);
  const histP = sources.signedTxs ? retry(`fastnear:signed:${account}`, () => sources.signedTxs!(network, account, HISTORY_LIMIT)).catch(() => null) : Promise.resolve(null);

  let live: AccessKeyEntry[] | null;
  try { live = await keysP; } catch { return base("could-not-check", HEALTH_TEXT.couldNotCheck); }
  if (live === null) return base("not-found", HEALTH_TEXT.notFound(network));
  const [info, recs, hist] = await Promise.all([infoP, recsP, histP]);
  // A missing source wasn't asked. A source that failed is not a green CLEAN.
  const historyFailed = !!sources.signedTxs && hist === null;
  const recordsFailed = !!sources.keyRecords && recs === null;
  if (historyFailed) notes.push(HEALTH_TEXT.noHistory);
  if (recordsFailed) notes.push(HEALTH_TEXT.noKeyRecords);
  const history: ChainTx[] = hist ?? [];
  const historyComplete = hist !== null && hist.length < HISTORY_LIMIT;

  // Indexer rows: the current row per key (not deleted), and every deletion.
  const recOf = new Map<string, KeyRecord>();
  for (const r of recs ?? []) if (r.deletedMs == null && !recOf.has(r.publicKey)) recOf.set(r.publicKey, r);
  const liveSet = new Set(live.map((k) => k.publicKey));
  const fullSet = new Set(live.filter((k) => k.permission === "FullAccess").map((k) => k.publicKey));

  // Fetch the add transactions (to learn who added each key) and mass-deletion transactions.
  const byHash = new Map<string, ChainTx>(history.map((t) => [t.hash, t]));
  const want: string[] = [];
  const order = [...live].sort((a, b) => Number(b.permission === "FullAccess") - Number(a.permission === "FullAccess"));
  for (const k of order) { const h = recOf.get(k.publicKey)?.createdTx; if (h && !byHash.has(h)) want.push(h); }
  const deletions = (recs ?? []).filter((r) => r.fullAccess && r.deletedTx && r.deletedMs != null && !liveSet.has(r.publicKey));
  for (const d of deletions) {
    const near = deletions.filter((x) => Math.abs(x.deletedMs! - d.deletedMs!) <= HOUR).length;
    if (near >= 2 && !byHash.has(d.deletedTx!)) want.push(d.deletedTx!);
  }
  const hashes = [...new Set(want)].slice(0, 40);
  if (hashes.length && sources.txsByHash) {
    const got = await ask(`fastnear:transactions:${hashes.length}`, () => sources.txsByHash!(network, hashes)).catch(() => [] as ChainTx[]);
    for (const t of got) byHash.set(t.hash, t);
  }
  const all = [...byHash.values()].sort((a, b) => b.timestampMs - a.timestampMs);
  const oldestSeen = history.length ? Math.min(...history.map((t) => t.timestampMs)) : null;

  // When the account began: its oldest known key (indexer rows include removed keys).
  const firstMs = Math.min(...(recs ?? []).map((r) => r.createdMs ?? Infinity), ...all.map((t) => t.timestampMs));

  // Dates for keys no indexer or history knows: the add height is in the nonce.
  let nonceLookups = 0;
  const reports: (KeyReport & { _addMs: number | null; _lastMs: number | null })[] = await Promise.all(order.map(async (k) => {
    const { addHeight, uses } = readNonce(k.nonce);
    const rec = recOf.get(k.publicKey);
    const addTx = (rec?.createdTx ? byHash.get(rec.createdTx) : undefined)
      ?? all.find((t) => t.signer === account || t.receiver === account ? t.actions.some((a) => a.kind === "addKey" && a.publicKey === k.publicKey) : false);
    let addMs: number | null = rec?.createdMs ?? addTx?.timestampMs ?? null;
    let from: KeyReport["addedFrom"] = rec?.createdMs != null ? "indexer" : addTx ? "history" : null;
    if (addMs == null && addHeight != null && sources.blockTimeMs && nonceLookups < NONCE_DATE_LOOKUPS) {
      nonceLookups++;
      // A skipped height has no block: try the next few.
      for (let h = addHeight; h < addHeight + 3 && addMs == null; h++) {
        addMs = await ask(`rpc:block:${h}`, () => sources.blockTimeMs!(network, h)).catch(() => null);
      }
      if (addMs != null) from = "nonce";
    }
    const last = history.find((t) => t.signerKey === k.publicKey && t.hash !== addTx?.hash) ?? null;
    const p = k.permission;
    const fc = p === "FullAccess" ? null : p;
    return {
      publicKey: k.publicKey,
      kind: fc ? "app" : "full",
      ...(fc ? { contract: fc.receiverId, methods: fc.methodNames, allowanceYocto: fc.allowanceYocto } : {}),
      addedAt: addMs != null ? new Date(addMs).toISOString() : null,
      addedFrom: from,
      ...(addTx ? { addedByKey: addTx.signerKey, addedBySigner: addTx.signer } : {}),
      uses,
      lastUsedAt: last ? new Date(last.timestampMs).toISOString() : null,
      probableWalletKey: false,
      flags: [],
      removable: /^(ed25519|secp256k1):/.test(k.publicKey),
      tidy: false,
      _addMs: addMs,
      _lastMs: last?.timestampMs ?? null,
    };
  }));
  const byKey = new Map(reports.map((r) => [r.publicKey, r]));

  // Full-access keys: red only with evidence.
  for (const r of reports.filter((x) => x.kind === "full")) {
    let why: string | null = null;
    const signed = all.filter((t) => t.signerKey === r.publicKey && t.signer === account);
    // (A) removed 2+ other full-access keys within an hour, and sent funds out in that hour.
    const removed = signed.flatMap((t) => t.actions.flatMap((a) => (a.kind === "deleteKey" && a.publicKey !== r.publicKey && !liveSet.has(a.publicKey) && isFullRemoved(a.publicKey, recs, fullSet) ? [{ k: a.publicKey, ms: t.timestampMs }] : [])));
    for (const x of removed) {
      const burst = new Set(removed.filter((y) => Math.abs(y.ms - x.ms) <= HOUR).map((y) => y.k));
      const sent = signed.some((t) => t.receiver !== account && Math.abs(t.timestampMs - x.ms) <= HOUR && t.actions.some((a) => a.kind === "transfer" && BigInt(a.depositYocto || "0") > 0n));
      if (burst.size >= 2 && sent) { why = HEALTH_TEXT.whyTakeover(burst.size); break; }
    }
    // (B) moved funds out like a drained account (the R18 signs), account now nearly empty.
    if (!why && info) {
      const ctxHistory = all.filter((t) => t.signer === account);
      for (const t of signed) {
        if (t.receiver === account || !t.actions.some((a) => a.kind === "transfer")) continue;
        const sign = drainedBy(t, ctxHistory, info as AccountInfo, HOUR);
        if (sign) { why = sign.takeover ? HEALTH_TEXT.whyTakeover(sign.takeover.keysRemoved) : HEALTH_TEXT.whyDrain(sign.minutesAfterKey); break; }
      }
    }
    // (C) added recently by another key of this account, with 2+ full-access keys.
    if (!why && r._addMs != null && now - r._addMs <= RECENT_FULL_KEY_DAYS * DAY && fullSet.size >= 2) {
      const byOther = r.addedBySigner === account && r.addedByKey && r.addedByKey !== r.publicKey;
      const adder = byOther ? byKey.get(r.addedByKey!) ?? null : null;
      const adderOld = byOther && (adder?._addMs == null || r._addMs - adder._addMs > DAY);
      const unknownAdder = !r.addedBySigner && Number.isFinite(firstMs) && r._addMs - firstMs > DAY;
      if (adderOld || unknownAdder) why = HEALTH_TEXT.whyRecent(Math.max(0, Math.floor((now - r._addMs) / DAY)));
    }
    if (why) r.flags.push({ level: "red", code: "UNKNOWN_FULL_KEY", text: HEALTH_TEXT.unknownFull(r._addMs != null ? fmtDate(r._addMs) : null), why });
  }

  // App keys: tidy-up notes, then contract risk (a few contracts, never your own account or well-known ones).
  for (const r of reports.filter((x) => x.kind === "app")) {
    if (r.methods!.length === 0 && r.contract !== account) r.flags.push({ level: "tidy", code: "ANY_METHOD", text: HEALTH_TEXT.anyMethod(r.contract!) });
    if (r.allowanceYocto === null) r.flags.push({ level: "tidy", code: "NO_ALLOWANCE", text: HEALTH_TEXT.noAllowance });
    const idle = idleDays(r, now, historyComplete, oldestSeen);
    if (idle != null && idle >= UNUSED_DAYS) r.flags.push({ level: "tidy", code: "UNUSED", text: HEALTH_TEXT.unused(Math.floor(idle / 30)) });
  }
  const contracts = [...new Set(reports.filter((r) => r.kind === "app" && r.contract && r.contract !== account && !wellKnown(network, r.contract)).map((r) => r.contract!))];
  const risky = new Set<string>();
  const cache = opts.drainerCache ?? new DrainerCache();
  await Promise.all(contracts.slice(0, CONTRACT_CHECKS).map(async (ct) => {
    const lim = opts.contractTimeoutMs ?? 8000;
    const isNew = (async () => {
      const ctx = makeCtx({ to: ct, network, asset: { symbol: "NEAR" }, destination: "unknown" }, classify(ct), sources, now, null, { sourceTimeoutMs: lim, optionalBudgetMs: lim });
      const facts = await withTimeout(ctx.accountFacts(), lim, "contract age").catch(() => null);
      if (!facts || facts.exists !== true || facts.contract === false) return false;
      let days: number | null = null;
      if (facts.createdAt) days = Math.max(0, Math.floor((now - Date.parse(facts.createdAt)) / DAY));
      else if (facts.created === "after-indexer" && facts.chainAgeDays != null && facts.chainAgeDays < 7) days = facts.chainAgeDays;
      if (days == null || days >= NEW_CONTRACT_DAYS) return false;
      const count = sources.txCount ? await withTimeout(sources.txCount(network, ct), lim, "contract history").catch(() => null) : null;
      return count != null ? count < LOW_HISTORY_TXS : days < 7;
    })();
    const drained = drainerCheck({ to: ct, network, myAccounts: [account] }, sources, { timeoutMs: lim }, cache).then((x) => x.status === "BLOCKED").catch(() => false);
    const s = Date.now();
    const [a, b] = await Promise.all([isNew, drained]);
    calls.push({ source: `contract:${ct}`, ok: true, ms: Date.now() - s, optional: true });
    if (a || b) risky.add(ct);
  }));
  for (const r of reports) if (r.kind === "app" && risky.has(r.contract!)) r.flags.unshift({ level: "amber", code: "RISKY_CONTRACT", text: HEALTH_TEXT.riskyContract(r.contract!), why: HEALTH_TEXT.riskyContractWhy });

  // The probable wallet key: the full-access key (no red flag) that signed last, else used most, else newest.
  const fa = reports.filter((r) => r.kind === "full" && !r.flags.some((x) => x.level === "red"));
  if (fa.length) {
    const pick = [...fa].sort((a, b) => (b._lastMs ?? -1) - (a._lastMs ?? -1) || (b.uses ?? 0) - (a.uses ?? 0) || (b._addMs ?? 0) - (a._addMs ?? 0))[0]!;
    pick.probableWalletKey = true;
  }

  const keys: KeyReport[] = reports.map(({ _addMs, _lastMs, ...k }) => k);
  const concern = (k: KeyReport) => k.flags.some((f) => f.level !== "tidy");
  for (const k of keys) k.tidy = k.flags.length > 0 && !concern(k);
  const levelRank = (k: KeyReport) => (k.flags.some((f) => f.level === "red") ? 0 : concern(k) ? 1 : k.tidy ? 3 : 2);
  keys.sort((a, b) => levelRank(a) - levelRank(b) || Number(b.kind === "full") - Number(a.kind === "full"));
  const fullCount = keys.filter((k) => k.kind === "full").length;
  const walletKey = keys.find((k) => k.probableWalletKey)?.publicKey;
  for (const k of keys) {
    if (!k.removable || (k.kind === "full" && fullCount === 1)) continue;
    k.remove = removeKeyPlan(network, account, k.publicKey, {
      ...(walletKey && walletKey !== k.publicKey ? { walletKey } : {}),
      ...(opts.callbackUrl ? { callbackUrl: opts.callbackUrl } : {}),
      walletKeyWarning: k.probableWalletKey, kind: k.kind,
    });
  }
  const flagged = keys.filter(concern).length;
  const tidy = keys.filter((k) => k.tidy).length;
  const danger = keys.some((k) => k.flags.some((f) => f.code === "UNKNOWN_FULL_KEY"));
  const red = keys.some((k) => k.flags.some((f) => f.level === "red"));
  const lookupGap = historyFailed || recordsFailed;
  const status: HealthStatus = danger ? "danger" : flagged || lookupGap ? "attention" : "clean";
  const summary = danger ? HEALTH_TEXT.danger : flagged ? HEALTH_TEXT.attention(flagged) : lookupGap ? HEALTH_TEXT.lookupGap : tidy ? HEALTH_TEXT.cleanTidy(tidy) : HEALTH_TEXT.clean;
  return {
    ...base(status, summary),
    red, moveFundsNow: danger, advice: danger ? HEALTH_TEXT.moveFunds : null, keys,
    counts: { full: fullCount, app: keys.filter((k) => k.kind === "app").length, flagged, tidy },
  };
}

function isFullRemoved(key: string, recs: KeyRecord[] | null, fullNow: Set<string>): boolean {
  if (fullNow.has(key)) return false;
  const r = recs?.find((x) => x.publicKey === key);
  return r ? r.fullAccess : true;
}

/** Days since an app key last did anything: its last signed tx, or its add when it was never used. */
function idleDays(r: { uses: number | null; _addMs: number | null; _lastMs: number | null }, now: number, complete: boolean, oldest: number | null): number | null {
  if (r._lastMs != null) return (now - r._lastMs) / DAY;
  if (r.uses === 0 && r._addMs != null) return (now - r._addMs) / DAY;
  // Used, but not in the newest history we read: it was last used before the oldest of it.
  if (!complete && oldest != null && r.uses != null && r.uses > 0) return (now - oldest) / DAY;
  return null;
}

export interface DeleteKeyLinks {
  meteor: string;
  /** MyNearWallet, mainnet only (its testnet site is being retired). */
  mynearwallet: string | null;
  /** The confirmation to show before opening. */
  confirm: string;
  /** The unsigned transaction in the links (base64 Borsh). */
  transaction: string;
  /** Where the wallet returns after signing. */
  callbackUrl: string;
}

/**
 * Unsigned wallet links that ask the account's own wallet to delete one key. The wallet fills in its
 * signing key, nonce and block hash; `walletKey` is only a placeholder. Gideon never signs.
 *
 * Meteor's /connect/{network}/sign page needs a callback_url (2+ characters): without one it shows
 * "Couldn't parse the correct arguments for signing the transaction". So a callback is always set,
 * by default the account on NearBlocks.
 */
export function deleteKeyLinks(network: Network, account: string, publicKey: string, o: { walletKey?: string; callbackUrl?: string } = {}): DeleteKeyLinks {
  const tx = toBase64(encodeTransaction({
    signerId: account, publicKey: o.walletKey ?? publicKey, receiverId: account, nonce: "0",
    actions: [{ type: "DeleteKey", publicKey }],
  }));
  const callbackUrl = o.callbackUrl && o.callbackUrl.length >= 2 ? o.callbackUrl : explorerAccountUrl(network, account);
  const txs = encodeURIComponent(tx);
  const cb = encodeURIComponent(callbackUrl);
  return {
    meteor: `https://wallet.meteorwallet.app/connect/${network}/sign?transactions=${txs}&callback_url=${cb}`,
    mynearwallet: network === "mainnet" ? `https://app.mynearwallet.com/sign?transactions=${txs}&callbackUrl=${cb}` : null,
    confirm: HEALTH_TEXT.confirm(short(publicKey.replace(/^[a-z0-9]+:/, ""), 6, 4)),
    transaction: tx,
    callbackUrl,
  };
}

/** Everything a person, a wallet or an AI agent needs to remove one key. Nothing here is signed. */
export interface RemoveKeyPlan {
  accountId: string;
  networkId: Network;
  publicKey: string;
  kind: "full" | "app";
  /** The one action, in the wallet-selector / NEAR Connect format. */
  action: { type: "DeleteKey"; params: { publicKey: string } };
  /** The same as a near-mcp (@nearai/near-mcp) tool call. */
  nearMcp: { tool: "account_delete_access_keys"; args: { accountId: string; networkId: Network; publicKey: string } };
  /** The same with near-cli-rs (signs with your keychain, asks before sending). */
  nearCli: string;
  /** Unsigned base64 transaction (placeholder signer key, nonce 0, zero block hash: the wallet fills them in). */
  transaction: string;
  links: { meteor: string; mynearwallet: string | null; callbackUrl: string };
  /** True when this may be the key your wallet signs with (Meteor refuses to remove its own key). */
  walletKeyWarning: boolean;
  /** Ask the user first; an agent must not remove a key on its own. */
  confirm: string;
}

export function removeKeyPlan(network: Network, account: string, publicKey: string, o: { walletKey?: string; callbackUrl?: string; walletKeyWarning?: boolean; kind?: "full" | "app" } = {}): RemoveKeyPlan {
  const l = deleteKeyLinks(network, account, publicKey, o);
  return {
    accountId: account, networkId: network, publicKey, kind: o.kind ?? "app",
    action: { type: "DeleteKey", params: { publicKey } },
    nearMcp: { tool: "account_delete_access_keys", args: { accountId: account, networkId: network, publicKey } },
    nearCli: `near account delete-keys ${account} public-keys ${publicKey} network-config ${network} sign-with-keychain send`,
    transaction: l.transaction,
    links: { meteor: l.meteor, mynearwallet: l.mynearwallet, callbackUrl: l.callbackUrl },
    walletKeyWarning: o.walletKeyWarning ?? false,
    confirm: l.confirm,
  };
}
