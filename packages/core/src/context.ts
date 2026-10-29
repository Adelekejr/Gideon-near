import type { AccountFacts, CheckInput, Classification, Asset, Destination, Sources, SourceCall } from "./types.js";
import { networkOfName } from "./classify.js";
import { NETWORKS } from "./networks.js";

export type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

export interface Ctx {
  input: CheckInput & { asset: Asset; destination: Destination };
  c: Classification;
  /** Calls a source once per key, records timing, never throws. */
  ask<T>(source: string, key: string, fn: (s: Sources) => Promise<T>): Promise<Settled<T>>;
  calls: SourceCall[];
  /** Clock (ms since epoch) for deadline checks. */
  now: number;
  /** Flag registry contract for R10, or null when none is configured. */
  registry: string | null;
  /** The recipient account's live facts (memoized; shares the view_account call with R3/R4). */
  accountFacts(): Promise<AccountFacts | null>;
}

/** Recipient kinds that are NEAR accounts Gideon looks up on chain. */
const LOOKUP_KINDS = new Set(["near-named", "near-implicit", "hex64-uppercase", "eth-implicit"]);
const NO_CODE = "11111111111111111111111111111111";

export function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
}

export function makeCtx(input: Ctx["input"], c: Classification, sources: Sources, now = Date.now(), registry: string | null = null): Ctx {
  const memo = new Map<string, Promise<Settled<unknown>>>();
  const calls: SourceCall[] = [];
  let facts: Promise<AccountFacts | null> | null = null;
  const ctx: Ctx = {
    input,
    c,
    calls,
    now,
    registry,
    accountFacts() {
      return (facts ??= readFacts(ctx, sources));
    },
    ask<T>(source: string, key: string, fn: (s: Sources) => Promise<T>) {
      const k = `${source}:${key}`;
      if (!memo.has(k)) {
        const t0 = Date.now();
        memo.set(
          k,
          fn(sources).then(
            (value) => { calls.push({ source: k, ok: true, ms: Date.now() - t0 }); return { ok: true as const, value }; },
            (e: unknown) => {
              const error = e instanceof Error ? e.message : String(e);
              calls.push({ source: k, ok: false, ms: Date.now() - t0, error });
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
  // Creation date is info only. Skip it when R7 reads the sender's history, so both fit in NearBlocks' free budget.
  if (sources.accountCreated && !input.from) {
    const t0 = Date.now();
    const key = `nearblocks-${net}:created:${id}`;
    try {
      const ms = await sources.accountCreated(net, id);
      ctx.calls.push({ source: key, ok: true, ms: Date.now() - t0, optional: true });
      if (ms) createdAt = new Date(ms).toISOString();
    } catch (e) {
      ctx.calls.push({ source: key, ok: false, ms: Date.now() - t0, optional: true, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const parts = [`Account exists on ${where}.`];
  if (createdAt) parts.push(`Created ${fmtDate(Date.parse(createdAt))}.`);
  parts.push(`Holds ${balanceNear} NEAR.`);
  if (contract) parts.push("Runs contract code.");
  return { id, network: net, exists: true, balanceNear, contract, ...(createdAt ? { createdAt } : {}), summary: parts.join(" ") };
}

export function yoctoToNear(yocto: string | number): string {
  const n = typeof yocto === "number" ? yocto / 1e24 : Number(BigInt(yocto) / 10n ** 18n) / 1e6;
  if (n > 0 && n < 0.0001) return "less than 0.0001"; // dust must not read as "0"
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}
