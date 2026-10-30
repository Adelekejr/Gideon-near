import type { AccountFacts, CheckInput, Classification, Asset, Destination, Sources, SourceCall } from "./types.js";
import { networkOfName } from "./classify.js";
import { NETWORKS } from "./networks.js";
import { withTimeout } from "./time.js";

/** Time limits for one check (all optional; see CheckOptions). */
export interface CtxLimits {
  sourceTimeoutMs?: number;
  optionalBudgetMs?: number;
  historyTimeoutMs?: number;
}

export interface AskOptions {
  /** Info-only lookup: a failure never makes the answer incomplete (marked optional in the calls list). */
  optional?: boolean;
  /** Overrides limits.sourceTimeoutMs for this lookup. */
  timeoutMs?: number;
}

export type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

export interface Ctx {
  input: CheckInput & { asset: Asset; destination: Destination };
  c: Classification;
  /** Calls a source once per key, records timing, never throws. */
  ask<T>(source: string, key: string, fn: (s: Sources) => Promise<T>, opts?: AskOptions): Promise<Settled<T>>;
  calls: SourceCall[];
  /** Clock (ms since epoch) for deadline checks. */
  now: number;
  /** Flag registry contract for R10, or null when none is configured. */
  registry: string | null;
  /** The recipient account's live facts (memoized; shares the view_account call with R3/R4). */
  accountFacts(): Promise<AccountFacts | null>;
  limits: CtxLimits;
}

/** Recipient kinds that are NEAR accounts Gideon looks up on chain. */
const LOOKUP_KINDS = new Set(["near-named", "near-implicit", "hex64-uppercase", "eth-implicit"]);
const NO_CODE = "11111111111111111111111111111111";

export function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
}

export function makeCtx(input: Ctx["input"], c: Classification, sources: Sources, now = Date.now(), registry: string | null = null, limits: CtxLimits = {}): Ctx {
  const memo = new Map<string, Promise<Settled<unknown>>>();
  const calls: SourceCall[] = [];
  let facts: Promise<AccountFacts | null> | null = null;
  const ctx: Ctx = {
    input,
    c,
    calls,
    now,
    registry,
    limits,
    accountFacts() {
      return (facts ??= readFacts(ctx, sources));
    },
    ask<T>(source: string, key: string, fn: (s: Sources) => Promise<T>, opts: AskOptions = {}) {
      const k = `${source}:${key}`;
      if (!memo.has(k)) {
        const t0 = Date.now();
        const opt = opts.optional ? { optional: true } : {};
        memo.set(
          k,
          withTimeout(Promise.resolve().then(() => fn(sources)), opts.timeoutMs ?? limits.sourceTimeoutMs, source).then(
            (value) => { calls.push({ source: k, ok: true, ms: Date.now() - t0, ...opt }); return { ok: true as const, value }; },
            (e: unknown) => {
              const error = e instanceof Error ? e.message : String(e);
              calls.push({ source: k, ok: false, ms: Date.now() - t0, ...opt, error });
              return { ok: false as const, error };
            },
          ),
        );
      }
      return memo.get(k) as Promise<Settled<T>>;
    },
  };
  return ctx;
}

async function readFacts(ctx: Ctx, sources: Sources): Promise<AccountFacts | null> {
  const { c, input } = ctx;
  const net = input.network;
  if (!LOOKUP_KINDS.has(c.kind)) return null;
  if (c.kind === "near-named") {
    const home = networkOfName(c.normalized);
    if (home && home !== net) return null; // R1 blocks: a name from the other network
  }
  const id = c.normalized;
  const where = NETWORKS[net].label;
  const r = await ctx.ask(`rpc-${net}`, `account:${id}`, (s) => s.viewAccount(net, id));
  if (!r.ok) return { id, network: net, exists: null, summary: `Couldn't check whether ${id} exists on ${where} (${r.error}).` };
  if (!r.value) {
    const named = c.kind === "near-named";
    return { id, network: net, exists: false,
      summary: named ? `No account called ${id} exists on ${where}.` : `This account has never been used on ${where}: it holds nothing and has no keys yet.` };
  }
  const balanceNear = yoctoToNear(r.value.amountYocto);
  const contract = !!r.value.codeHash && r.value.codeHash !== NO_CODE;
  let createdAt: string | undefined;
  let created: AccountFacts["created"] = "unavailable";
  let indexerLagBlocks: number | undefined;
  let indexedHeight: number | undefined;
  let indexedNoDate = false;
  // Always look up the creation date (also in the wallet flow): a brand-new recipient is a scam signal.
  // Live sources cache it, so repeat checks don't spend NearBlocks' free budget.
  // Info-only lookups share one small time budget; when it runs out the date reads "unavailable".
  const budget = ctx.limits.optionalBudgetMs ?? ctx.limits.sourceTimeoutMs;
  const until = budget != null && budget > 0 ? Date.now() + budget : Infinity;
  if (sources.accountCreated) {
    const t0 = Date.now();
    const key = `nearblocks-${net}:created:${id}`;
    try {
      const raw = await withTimeout(sources.accountCreated(net, id), left(until, ctx.limits.sourceTimeoutMs), "creation date lookup");
      ctx.calls.push({ source: key, ok: true, ms: Date.now() - t0, optional: true });
      const info = typeof raw === "number" ? { createdMs: raw, indexed: true } : raw;
      indexedNoDate = !!info && info.indexed && !info.createdMs;
      if (info?.createdMs) {
        createdAt = new Date(info.createdMs).toISOString();
        created = "known";
      } else if (info && !info.indexed && info.indexedHeight && r.value.blockHeight) {
        // The indexer has never seen this account, yet the live chain has it: it was created
        // after the indexer's last block. Accounts the indexer does know (even without a date) never land here.
        indexedHeight = info.indexedHeight;
        indexerLagBlocks = Math.max(0, r.value.blockHeight - info.indexedHeight);
        created = "after-indexer";
      }
    } catch (e) {
      ctx.calls.push({ source: key, ok: false, ms: Date.now() - t0, optional: true, error: e instanceof Error ? e.message : String(e) });
    }
  }
  // The indexer knows the account but has no creation date: it may date from the chain's launch
  // (genesis accounts like illia.near have no creation transaction). One archival read settles it.
  if (created === "unavailable" && indexedNoDate && sources.accountAtGenesis && Date.now() < until) {
    const t0 = Date.now();
    const key = `archival-${net}:genesis:${id}`;
    try {
      const atGenesis = await withTimeout(sources.accountAtGenesis(net, id), left(until, ctx.limits.sourceTimeoutMs), "genesis lookup");
      ctx.calls.push({ source: key, ok: true, ms: Date.now() - t0, optional: true });
      if (atGenesis) {
        createdAt = new Date(Date.parse(NETWORKS[net].genesis.time)).toISOString();
        created = "known";
      }
    } catch (e) {
      ctx.calls.push({ source: key, ok: false, ms: Date.now() - t0, optional: true, error: e instanceof Error ? e.message : String(e) });
    }
  }
  let chainAgeDays: number | undefined;
  if (created === "after-indexer" && sources.accountExistedAt && Date.now() < until) chainAgeDays = await chainAge(ctx, sources, id, until);
  const parts = [`Account exists on ${where}.`];
  if (createdAt) parts.push(`Created ${fmtDate(Date.parse(createdAt))}.`);
  else if (chainAgeDays === 0) parts.push("Created in the last 24 hours.");
  else if (chainAgeDays != null && chainAgeDays < 7) parts.push(`Created ${chainAgeDays} day${chainAgeDays === 1 ? "" : "s"} ago.`);
  else if (chainAgeDays != null) parts.push("Created more than 7 days ago.");
  else if (created === "after-indexer") parts.push("Created recently (newer than our indexer's data).");
  else parts.push("Creation date unavailable.");
  parts.push(`Holds ${balanceNear} NEAR.`);
  if (contract) parts.push("Runs contract code.");
  return { id, network: net, exists: true, balanceNear, contract, ...(createdAt ? { createdAt } : {}), created,
    ...(indexedHeight != null ? { indexedHeight, indexerLagBlocks } : {}), ...(chainAgeDays != null ? { chainAgeDays } : {}), summary: parts.join(" ") };
}

const DAY = 86_400_000;

/** Time left before `until`, capped by the per-source limit. undefined = no limit. */
function left(until: number, cap?: number): number | undefined {
  const rest = until === Infinity ? undefined : Math.max(1, until - Date.now());
  if (rest == null) return cap;
  return cap == null ? rest : Math.min(rest, cap);
}

/**
 * Date an account the indexer hasn't reached yet, from archival chain state:
 * did it exist 1 day ago? 7 days ago? Then narrow down the day. Returns whole days
 * since creation (0 = within 24h, 7 = already existed a week ago), or undefined when unknown.
 */
async function chainAge(ctx: Ctx, sources: Sources, id: string, until = Infinity): Promise<number | undefined> {
  const net = ctx.input.network;
  const existed = async (days: number): Promise<boolean | null> => {
    const t0 = Date.now();
    const key = `archival-rpc-${net}:existed:${id}@-${days}d`;
    if (t0 >= until) return null; // out of time: stop dating, the verdict doesn't wait for it
    try {
      const v = await withTimeout(sources.accountExistedAt!(net, id, ctx.now - days * DAY), left(until, ctx.limits.sourceTimeoutMs), "archival lookup");
      ctx.calls.push({ source: key, ok: true, ms: Date.now() - t0, optional: true });
      return v;
    } catch (e) {
      ctx.calls.push({ source: key, ok: false, ms: Date.now() - t0, optional: true, error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  };
  const d1 = await existed(1);
  if (d1 === null) return undefined;
  if (!d1) return 0;
  const d7 = await existed(7);
  if (d7 === null) return undefined;
  if (d7) return 7;
  // Existed 1 day ago, not 7: binary search the day (at most 3 more lookups).
  let lo = 1, hi = 7;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const e = await existed(mid);
    if (e === null) return lo;
    if (e) lo = mid; else hi = mid;
  }
  return lo;
}

export function yoctoToNear(yocto: string | number): string {
  const n = typeof yocto === "number" ? yocto / 1e24 : Number(BigInt(yocto) / 10n ** 18n) / 1e6;
  if (n > 0 && n < 0.0001) return "less than 0.0001"; // dust must not read as "0"
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}
