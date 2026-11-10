import { accountHealth, check, checkDrainer, checkTransaction, DrainerCache, drainerWanted, drainerFailedFinding, withDrainer, type CheckResult, type TxCheckResult } from "@gideon/core";
import { liveSources } from "@gideon/sources";
import { load, type LastCheck } from "./lib/settings.js";
import type { CheckRequest, CheckResponse, DrainerRequest, DrainerResponse, HealthRequestMsg, HealthResponse, NetUsed, TxRequestMsg, TxResponse } from "./lib/messages.js";
import { resolveNetwork, walletNetworkHint } from "./lib/resolve.js";
import { titleOf } from "./lib/view.js";
import { cachedSources, TtlCache } from "./lib/cache.js";
import { LIMITS } from "./lib/limits.js";
import { cacheable, checkKey } from "./lib/runcache.js";
import { resolveSender, sendsOn, type SenderUsed } from "./lib/sender.js";

/**
 * The engine runs here, in the extension's service worker, so lookups go from the
 * extension to the public APIs listed in host_permissions, never through the page.
 * Every check is time-limited (LIMITS): the in-page card must always resolve, even on a slow phone.
 */
const sources = cachedSources(liveSources({ timeoutMs: LIMITS.requestMs }), LIMITS.cacheMs, Date.now, LIMITS.historyCacheMs);
const results = new TtlCache<CheckResult>(LIMITS.cacheMs);
// Drained-wallet answers per network and recipient (10 min); failures and time-outs aren't kept.
const drainers = new DrainerCache();

export async function runRequest(req: CheckRequest): Promise<{ result: CheckResult; net: NetUsed; sender?: SenderUsed }> {
  const t0 = Date.now();
  const { settings, contacts, stats, myAccounts, sends } = await load();
  // A network in the request is a choice made in the popup; otherwise Auto or the manual setting decides.
  const net: NetUsed = req.input.network
    ? { network: req.input.network, source: "manual", why: settings.networkMode === "auto" ? "from the token you picked" : "set by you in Gideon", sure: true }
    : await resolveNetwork(settings.networkMode, req.page, req.input.to, sources, LIMITS.sourceMs);
  // The sender: a full name from the wallet header, or the shortened one matched to your accounts.
  // Never saved as yours from the page (any page can show any name): the card asks you instead.
  const resolved = req.sender ? resolveSender(req.sender, myAccounts) : undefined;
  const sender = resolved ? { ...resolved, ...(resolved.account && myAccounts.includes(resolved.account) ? { confirmed: true } : {}) } : undefined;
  const device = sendsOn(sends, net.network);
  const walletNetwork = walletNetworkHint(net, req.page, sender?.account);
  const input = {
    ...req.input,
    // An unconfirmed sender that equals the recipient would make the recipient look like "your own
    // account" (account planting): then the sender is left out and counts as unknown.
    ...(sender?.account && (sender.confirmed || sender.account !== req.input.to.trim().toLowerCase()) ? { from: sender.account } : {}),
    network: net.network,
    addressBook: contacts,
    ...(device.length ? { deviceSends: device } : {}),
    ...(walletNetwork ? { walletNetwork } : {}),
  };
  // Same address, network and inputs within a few minutes (or already running): reuse the answer.
  const result = await results.wrap(checkKey(input), () =>
    check(input, sources, {
      deadlineMs: Math.max(1500, LIMITS.totalMs - (Date.now() - t0)),
      sourceTimeoutMs: LIMITS.sourceMs,
      optionalBudgetMs: LIMITS.optionalMs,
      historyTimeoutMs: LIMITS.historyMs,
    }), cacheable);
  // A refill only fills in the creation date on a card already counted (and maybe already
  // updated by the drained-wallet check), so it changes neither the counts nor "last check".
  if (req.refill) return { result, net, ...(sender ? { sender } : {}) };
  const last: LastCheck = {
    host: req.host,
    net: `${net.network} · ${net.why}`,
    to: result.input.to,
    verdict: result.verdict,
    couldNotCheck: result.headline?.status === "COULD_NOT_CHECK",
    title: titleOf(result),
    at: result.checkedAt,
    ...(result.input.from ? { from: result.input.from } : {}),
  };
  await chrome.storage.local.set({
    stats: { checked: stats.checked + 1, stopped: stats.stopped + (result.verdict === "BLOCKED" ? 1 : 0) },
    last,
  });
  return { result, net, ...(sender ? { sender } : {}) };
}

/**
 * The drained-wallet check (R18), asked for after the card already shows the verdict. It looks
 * at the recipient's last few senders (time-limited, cached) and returns the result with it merged.
 */
export async function runDrainer(req: DrainerRequest): Promise<CheckResult> {
  const r = req.result;
  if (!drainerWanted(r)) return r;
  const { myAccounts, stats, last } = await load();
  // A sender read off the page only counts as yours once you confirmed it (else R18 would skip it).
  const trustFrom = !!r.input.from && myAccounts.includes(r.input.from);
  const merged = await checkDrainer(r, sources, { myAccounts, cache: drainers, trustFrom }, { timeoutMs: LIMITS.drainerMs })
    .catch(() => withDrainer(r, drainerFailedFinding()));
  // A stop found only now still counts, and the popup's "last check" line follows it.
  if (merged.verdict !== r.verdict && last && last.verdict !== merged.verdict && last.to === r.input.to && last.at === r.checkedAt) {
    await chrome.storage.local.set({
      stats: { checked: stats.checked, stopped: stats.stopped + (merged.verdict === "BLOCKED" ? 1 : 0) },
      last: { ...last, verdict: merged.verdict, title: titleOf(merged) },
    });
  }
  return merged;
}

chrome.runtime.onMessage.addListener((msg: DrainerRequest, _sender, reply: (r: DrainerResponse) => void) => {
  if (msg?.type !== "gideon:drainer") return false;
  runDrainer(msg)
    .then((result) => reply({ ok: true, result }))
    .catch((e: unknown) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  return true; // async reply
});

chrome.runtime.onMessage.addListener((msg: CheckRequest, _sender, reply: (r: CheckResponse) => void) => {
  if (msg?.type !== "gideon:check") return false;
  runRequest(msg)
    .then(({ result, net, sender }) => reply({ ok: true, result, net, ...(sender ? { sender } : {}) }))
    .catch((e: unknown) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  return true; // async reply
});

/**
 * A wallet's transaction request, read from its approval screen or address. Your accounts,
 * contacts and sends on this device are never "unseen". Not counted in the popup's send stats.
 */
export async function runTx(req: TxRequestMsg): Promise<TxCheckResult> {
  const { contacts, myAccounts, sends } = await load();
  return checkTransaction({
    request: req.request,
    ...(req.network ? { network: req.network } : {}),
    ...(req.signerId ? { signerId: req.signerId } : {}),
    ...(req.origin ? { origin: req.origin } : {}),
    ...(req.screenOnly ? { screenOnly: true } : {}),
    myAccounts,
    addressBook: contacts,
    // "Sent here before" only counts on the same network (0.3.0's address check does the same).
    deviceSendsByNetwork: { mainnet: sendsOn(sends, "mainnet"), testnet: sendsOn(sends, "testnet") },
  }, sources, { sourceTimeoutMs: LIMITS.sourceMs, drainerTimeoutMs: LIMITS.drainerMs, drainerCache: drainers });
}

chrome.runtime.onMessage.addListener((msg: TxRequestMsg, _sender, reply: (r: TxResponse) => void) => {
  if (msg?.type !== "gideon:tx") return false;
  runTx(msg)
    .then((result) => reply({ ok: true, result }))
    .catch((e: unknown) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  return true; // async reply
});

/**
 * "Check my account" (popup): who can act for an account, from public key data. Read-only:
 * it never builds or sends a transaction here; the popup only builds links to the wallet.
 */
chrome.runtime.onMessage.addListener((msg: HealthRequestMsg, _sender, reply: (r: HealthResponse) => void) => {
  if (msg?.type !== "gideon:health") return false;
  accountHealth({ account: msg.account, network: msg.network }, sources, { sourceTimeoutMs: LIMITS.healthSourceMs, drainerCache: drainers })
    .then((result) => reply({ ok: true, result }))
    .catch((e: unknown) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  return true; // async reply
});

chrome.runtime.onInstalled.addListener(async () => {
  const s = await load();
  await chrome.storage.local.set({ settings: s.settings, contacts: s.contacts, stats: s.stats });
});
