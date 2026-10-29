import { check, type CheckResult } from "@gideon/core";
import { liveSources } from "@gideon/sources";
import { load, type LastCheck } from "./lib/settings.js";
import type { CheckRequest, CheckResponse, NetUsed } from "./lib/messages.js";
import { resolveNetwork } from "./lib/resolve.js";
import { titleOf } from "./lib/view.js";
import { cachedSources, TtlCache } from "./lib/cache.js";
import { LIMITS } from "./lib/limits.js";
import { cacheable, checkKey } from "./lib/runcache.js";

/**
 * The engine runs here, in the extension's service worker, so lookups go from the
 * extension to the public APIs listed in host_permissions, never through the page.
 * Every check is time-limited (LIMITS): the in-page card must always resolve, even on a slow phone.
 */
const sources = cachedSources(liveSources({ timeoutMs: LIMITS.requestMs }), LIMITS.cacheMs);
const results = new TtlCache<CheckResult>(LIMITS.cacheMs);

export async function runRequest(req: CheckRequest): Promise<{ result: CheckResult; net: NetUsed }> {
  const t0 = Date.now();
  const { settings, contacts, stats } = await load();
  // A network in the request is a choice made in the popup; otherwise Auto or the manual setting decides.
  const net: NetUsed = req.input.network
    ? { network: req.input.network, source: "manual", why: settings.networkMode === "auto" ? "from the token you picked" : "set by you in Gideon", sure: true }
    : await resolveNetwork(settings.networkMode, req.page, req.input.to, sources, LIMITS.sourceMs);
  const input = { ...req.input, network: net.network, addressBook: contacts };
  // Same address, network and inputs within a few minutes (or already running): reuse the answer.
  const result = await results.wrap(checkKey(input), () =>
    check(input, sources, {
      deadlineMs: Math.max(1500, LIMITS.totalMs - (Date.now() - t0)),
      sourceTimeoutMs: LIMITS.sourceMs,
      optionalBudgetMs: LIMITS.optionalMs,
    }), cacheable);
  const last: LastCheck = {
    host: req.host,
    net: `${net.network} · ${net.why}`,
    to: result.input.to,
    verdict: result.verdict,
    couldNotCheck: result.headline?.status === "COULD_NOT_CHECK",
    title: titleOf(result),
    at: result.checkedAt,
  };
  await chrome.storage.local.set({
    stats: { checked: stats.checked + 1, stopped: stats.stopped + (result.verdict === "BLOCKED" ? 1 : 0) },
    last,
  });
  return { result, net };
}

chrome.runtime.onMessage.addListener((msg: CheckRequest, _sender, reply: (r: CheckResponse) => void) => {
  if (msg?.type !== "gideon:check") return false;
  runRequest(msg)
    .then(({ result, net }) => reply({ ok: true, result, net }))
    .catch((e: unknown) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  return true; // async reply
});

chrome.runtime.onInstalled.addListener(async () => {
  const s = await load();
  await chrome.storage.local.set({ settings: s.settings, contacts: s.contacts, stats: s.stats });
});
