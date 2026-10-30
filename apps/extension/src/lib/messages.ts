import { withTimeout, type CheckInput, type CheckResult, type Network, type TxCheckResult } from "@gideon/core";
import type { NetHint } from "./network.js";
import type { SenderHint, SenderUsed } from "./sender.js";

export interface CheckRequest {
  type: "gideon:check";
  input: Omit<CheckInput, "network" | "addressBook"> & Partial<Pick<CheckInput, "network">>;
  /** Page host, for the popup's "last check" line. Empty for checks made in the popup. */
  host: string;
  /** What the page says about its network (content script only). Never page text, only the answer. */
  page?: NetHint;
  /** The account the wallet shows as signed in (names only). */
  sender?: SenderHint;
  /** A quiet follow-up that only fills in a missed creation date: not counted again, "last check" left as is. */
  refill?: boolean;
}

/** The network a check ran on, and why, for the card. */
export interface NetUsed {
  network: Network;
  source: NetHint["source"];
  why: string;
  sure: boolean;
}

export type CheckResponse =
  | { ok: true; result: CheckResult; net?: NetUsed; sender?: SenderUsed }
  | { ok: false; error: string; /** This page's copy of Gideon was replaced by an update or reload: reload the page. */ orphaned?: true };

/** Ask the worker for the drained-wallet check (R18) on a finished result; the answer is the merged result. */
export interface DrainerRequest {
  type: "gideon:drainer";
  result: CheckResult;
}
export type DrainerResponse = { ok: true; result: CheckResult } | { ok: false; error: string };

type Send = (msg: CheckRequest) => Promise<CheckResponse | undefined>;
const viaRuntime: Send = (msg) => chrome.runtime.sendMessage(msg);

/**
 * False once the extension this script belongs to was updated, reloaded or removed while the page
 * stayed open. Chrome then cuts the old script off (chrome.runtime.id goes away) and every call
 * throws "Extension context invalidated". Only reloading the page brings the new version in.
 */
export function extensionAlive(): boolean {
  try {
    return typeof chrome !== "undefined" && !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

const ORPHANED = /context invalidated|extension context/i;
// The service worker was asleep, stopped by the browser, or stopped mid-check: worth one more try.
const WORKER_GONE = /receiving end does not exist|could not establish connection|message port closed|stopped before it answered/i;

/**
 * Ask the service worker for a check. Never hangs: after `timeoutMs` it answers { ok: false } so
 * the card can say so. If the worker didn't answer (Android browsers stop MV3 workers often), it
 * waits `retryAfterMs` and asks once more; sending the message wakes the worker again.
 * If this script was orphaned by an update, it answers { ok: false, orphaned: true } at once.
 */
export function sendCheck(req: Omit<CheckRequest, "type">, timeoutMs?: number, send: Send = viaRuntime, alive: () => boolean = extensionAlive, retryAfterMs = 250): Promise<CheckResponse> {
  const gone: CheckResponse = { ok: false, error: "Gideon was updated. Reload this page to keep checking.", orphaned: true };
  if (!alive()) return Promise.resolve(gone);
  const once = (): Promise<CheckResponse> =>
    Promise.resolve()
      .then(() => send({ type: "gideon:check", ...req }))
      .then((r): CheckResponse => r ?? { ok: false, error: "The extension stopped before it answered." })
      .catch((e: unknown): CheckResponse => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  const asked = once().then(async (r) => {
    if (r.ok) return r;
    if (!alive() || ORPHANED.test(r.error)) return gone;
    if (!WORKER_GONE.test(r.error)) return r;
    await new Promise((res) => setTimeout(res, retryAfterMs));
    if (!alive()) return gone;
    const again = await once();
    return !again.ok && (!alive() || ORPHANED.test(again.error)) ? gone : again;
  });
  return withTimeout(asked, timeoutMs, "The check").catch((e: unknown): CheckResponse => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
}

/**
 * The follow-up drained-wallet check. Never throws or hangs: any failure, time-out or orphaned
 * script answers null and the card simply stays as it is.
 */
export function sendDrainer(result: CheckResult, timeoutMs?: number, send: (m: DrainerRequest) => Promise<DrainerResponse | undefined> = (m) => chrome.runtime.sendMessage(m), alive: () => boolean = extensionAlive): Promise<CheckResult | null> {
  if (!alive()) return Promise.resolve(null);
  const asked = Promise.resolve()
    .then(() => send({ type: "gideon:drainer", result }))
    .then((r) => (r?.ok ? r.result : null));
  return withTimeout(asked, timeoutMs, "The drained-wallet check").catch(() => null);
}

/** Check a wallet's transaction request (found on the approval screen or in its address). */
export interface TxRequestMsg {
  type: "gideon:tx";
  request: string | object;
  network?: Network;
  signerId?: string;
  origin?: string;
  host: string;
}
export type TxResponse = { ok: true; result: TxCheckResult } | { ok: false; error: string; orphaned?: true };

/** Ask the worker to check a transaction request. Never throws or hangs. */
export function sendTx(req: Omit<TxRequestMsg, "type">, timeoutMs?: number, send: (m: TxRequestMsg) => Promise<TxResponse | undefined> = (m) => chrome.runtime.sendMessage(m), alive: () => boolean = extensionAlive): Promise<TxResponse> {
  if (!alive()) return Promise.resolve({ ok: false, error: "Gideon was updated. Reload this page to keep checking.", orphaned: true });
  const asked = Promise.resolve()
    .then(() => send({ type: "gideon:tx", ...req }))
    .then((r): TxResponse => r ?? { ok: false, error: "The extension stopped before it answered." });
  return withTimeout(asked, timeoutMs, "The check").catch((e: unknown): TxResponse => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
}
