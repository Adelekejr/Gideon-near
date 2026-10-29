import type { CheckInput, CheckResult, Network } from "@gideon/core";
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

export function sendCheck(req: Omit<CheckRequest, "type">): Promise<CheckResponse> {
  return chrome.runtime.sendMessage({ type: "gideon:check", ...req } satisfies CheckRequest);
}
