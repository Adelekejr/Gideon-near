import { check, checkDrainer, DrainerCache, withDrainer, drainerFailedFinding, type CheckInput, type CheckResult, type Network, type Sources } from "@gideon/core";
import { liveSources, replaySources, type Recording } from "@gideon/sources";
import casesJson from "../../../demo/cases.json";
import fixtures from "../../../demo/fixtures.json";
import { getContacts } from "./state";

export interface DemoCase { id: string; title: string; input: CheckInput; expect: { verdict: string; headline: string | null } }
export const CASES: DemoCase[] = (casesJson as { cases: DemoCase[] }).cases;

/** Short button labels for the real-world examples. */
export const CASE_LABELS: Record<string, string> = {
  "tron-hash": "Tron tx hash pasted",
  "evm-address": "Ethereum address",
  "intents-wrong-token": "Finished Intents deposit",
  "wnear-to-exchange": "wNEAR to an exchange",
  lookalike: "Lookalike of a contact",
  "wrong-network-name": ".near on testnet",
  "tron-address": "Tron address",
  safe: "A safe send",
};

let live: Sources | null = null;
/** Live = free public APIs straight from the browser. Replay = recorded answers in demo/fixtures.json. */
export function sources(replay: boolean): Sources {
  if (replay) return replaySources((fixtures as unknown as { answers: Recording }).answers);
  return (live ??= liveSources({ timeoutMs: 8000 }));
}

/** Your own history (lookalikes of past sends, first send) is info-only: it never holds the verdict longer than this. */
export const HISTORY_MS = 3000;

export function runCheck(input: CheckInput, replay = false): Promise<CheckResult> {
  return check(input, sources(replay), { historyTimeoutMs: HISTORY_MS });
}

const drainers = new DrainerCache();
/** Time limit for the drained-wallet check (R18), which runs after the verdict shows. */
export const DRAINER_MS = 8000;

/**
 * The drained-wallet check on a finished result: looks at the recipient's recent senders and
 * returns the result with R18 merged in. Never throws; with recorded answers it doesn't run.
 */
export function runDrainer(r: CheckResult, replay = false, o: { trustFrom?: boolean } = {}): Promise<CheckResult> {
  // `from` only switches the check off for "your own account" when it's really yours (the wallet
  // you connected on the send page). A `from` in a checker link is just a name anyone can type.
  return checkDrainer(r, sources(replay), { cache: drainers, trustFrom: o.trustFrom ?? false }, { timeoutMs: DRAINER_MS })
    .catch(() => withDrainer(r, drainerFailedFinding()));
}

/**
 * Network stored on an example case, or null when this isn't a known example.
 * The checker runs the example on that network, so the visible selector has to follow it.
 */
export function exampleCheckNetwork(exampleId: string | null): Network | null {
  if (!exampleId) return null;
  const c = CASES.find((x) => x.id === exampleId);
  return c?.input.network ?? null;
}

/** Build a CheckInput from check.html query params. */
export function inputFromQuery(q: URLSearchParams, network: Network): { input: CheckInput; replay: boolean; caseId?: string } {
  const replay = q.get("replay") === "1";
  const id = q.get("example");
  const c = id ? CASES.find((x) => x.id === id) : undefined;
  if (c) return { input: structuredClone(c.input), replay, caseId: c.id };
  const symbol = q.get("asset") || "NEAR";
  const contract = q.get("contract") || undefined;
  const input: CheckInput = {
    to: q.get("to") ?? "",
    network,
    asset: { symbol, ...(contract ? { contract } : {}) },
    destination: (q.get("dest") as CheckInput["destination"]) || "unknown",
  };
  const amount = q.get("amount"); if (amount) input.amount = amount;
  const ex = q.get("exchange"); if (ex) input.exchange = ex;
  const from = q.get("from"); if (from) input.from = from;
  const chain = q.get("chain"); if (chain) input.bridgeChain = chain;
  const book = getContacts(); if (book.length) input.addressBook = book;
  return { input, replay };
}
