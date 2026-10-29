import { withTimeout, type CheckInput, type CheckResult, type Network } from "@gideon/core";
import type { NetHint } from "./network.js";

export interface CheckRequest {
  type: "gideon:check";
  input: Omit<CheckInput, "network" | "addressBook"> & Partial<Pick<CheckInput, "network">>;
  /** Page host, for the popup's "last check" line. Empty for checks made in the popup. */
  host: string;
  /** What the page says about its network (content script only). Never page text, only the answer. */
  page?: NetHint;
}

/** The network a check ran on, and why, for the card. */
export interface NetUsed {
  network: Network;
  source: NetHint["source"];
  why: string;
  sure: boolean;
}

export type CheckResponse = { ok: true; result: CheckResult; net?: NetUsed } | { ok: false; error: string };

type Send = (msg: CheckRequest) => Promise<CheckResponse | undefined>;
const viaRuntime: Send = (msg) => chrome.runtime.sendMessage(msg);

/**
 * Ask the service worker for a check. Never hangs: after `timeoutMs` (or if the worker was
 * stopped mid-check and never replies) it answers { ok: false } so the card can say so.
 */
export function sendCheck(req: Omit<CheckRequest, "type">, timeoutMs?: number, send: Send = viaRuntime): Promise<CheckResponse> {
  const asked = Promise.resolve().then(() => send({ type: "gideon:check", ...req }));
  return withTimeout(asked, timeoutMs, "The check")
    .then((r): CheckResponse => r ?? { ok: false, error: "The extension stopped before it answered." })
    .catch((e: unknown): CheckResponse => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
}
