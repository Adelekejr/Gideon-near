import { check, type CheckResult } from "@gideon/core";
import { liveSources } from "@gideon/sources";
import { load, type LastCheck } from "./lib/settings.js";
import type { CheckRequest, CheckResponse } from "./lib/messages.js";

/**
 * The engine runs here, in the extension's service worker, so lookups go from the
 * extension to the public APIs listed in host_permissions, never through the page.
 */
const sources = liveSources({ timeoutMs: 8000 });

export async function runRequest(req: CheckRequest): Promise<CheckResult> {
  const { settings, contacts, stats } = await load();
  const input = { ...req.input, network: req.input.network ?? settings.network, addressBook: contacts };
  const result = await check(input, sources);
  const last: LastCheck = {
    host: req.host,
    to: result.input.to,
    verdict: result.verdict,
    couldNotCheck: result.headline?.status === "COULD_NOT_CHECK",
    title: result.headline?.title ?? "Every check that applies passed",
    at: result.checkedAt,
  };
  await chrome.storage.local.set({
    stats: { checked: stats.checked + 1, stopped: stats.stopped + (result.verdict === "BLOCKED" ? 1 : 0) },
    last,
  });
  return result;
}

chrome.runtime.onMessage.addListener((msg: CheckRequest, _sender, reply: (r: CheckResponse) => void) => {
  if (msg?.type !== "gideon:check") return false;
  runRequest(msg)
    .then((result) => reply({ ok: true, result }))
    .catch((e: unknown) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  return true; // async reply
});

chrome.runtime.onInstalled.addListener(async () => {
  const s = await load();
  await chrome.storage.local.set({ settings: s.settings, contacts: s.contacts, stats: s.stats });
});
