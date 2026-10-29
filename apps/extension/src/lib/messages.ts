import type { CheckInput, CheckResult } from "@gideon/core";

export interface CheckRequest {
  type: "gideon:check";
  input: Omit<CheckInput, "network" | "addressBook"> & Partial<Pick<CheckInput, "network">>;
  /** Page host, for the popup's "last check" line. Empty for checks made in the popup. */
  host: string;
}

export type CheckResponse = { ok: true; result: CheckResult } | { ok: false; error: string };

export function sendCheck(req: Omit<CheckRequest, "type">): Promise<CheckResponse> {
  return chrome.runtime.sendMessage({ type: "gideon:check", ...req } satisfies CheckRequest);
}
