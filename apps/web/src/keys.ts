import { accountHealth, fmtDate, HEALTH_TEXT, type AccountHealthResult, type KeyReport, type Network } from "@gideon/core";
import { initChrome, stopper, esc, footer, playVerdict } from "./chrome";
import { getNetwork } from "./state";
import { sources } from "./run";
import type { RemoveWallet, WalletState } from "./remove-wallet";

/** New in 0.3.0 (beyond the approved text). */
export const KEYS_TEXT = {
  removeInWallet: "Remove key in my wallet",
  orLinks: "Or open the removal straight in a wallet:",
  connecting: "Opening your wallets…",
  connected: (a: string, w: string | null) => `Connected as ${a}${w ? ` (${w})` : ""}.`,
  mismatch: (got: string, want: string) => `Your wallet is signed in as ${got}, not ${want}. Switch to ${want} to remove this key.`,
  switchWallet: "Switch wallet",
  howSignIn: "Connecting shares your account name only. Gideon doesn't ask your wallet to add a key and can't move funds. Your wallet shows the removal and you approve it there.",
  sent: "Your wallet sent the removal. Checking again…",
  removed: "Key removed.",
  stillThere: "That key is still on the account. If your wallet showed an error, try again or use another wallet.",
  failed: (m: string) => `Your wallet didn't remove the key: ${m}`,
  tidyChip: "TIDY",
} as const;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const out = $("out"), keysEl = $("keys");
let last: AccountHealthResult | null = null;
/** The key whose remove step is open, and whether its wallet-key warning box is ticked. */
let open: string | null = null;
let ticked = false;
/** Wallet-selector state for the open remove step. Loaded only on first use. */
let ws: RemoveWallet | null = null;
let wstate: WalletState = { accountId: null, wallet: null };
let wbusy = false;
let wmsg: { cls: "warn" | "safe"; text: string } | null = null;
const params = new URLSearchParams(location.search);
/** Key from ?key= (the extension's "Remove with any wallet"): open its remove step after the check. */
let wantKey = params.get("key");
/** Key from ?removed= (we came back from a browser wallet). */
let removedKey = params.get("removed");

initChrome("Account health", () => { const a = acct(); if (a) void run(a); });
$("heading").textContent = HEALTH_TEXT.heading;
$("footnote").textContent = HEALTH_TEXT.footer;
$("foot").innerHTML = footer("GIDEON · account health");

const acct = () => ($("acct") as HTMLInputElement).value.trim().toLowerCase();
/** .near is mainnet and .testnet is testnet; other names (implicit accounts) follow the site's network switch. */
const qNet = params.get("network");
const netFor = (a: string): Network => (a.endsWith(".near") ? "mainnet" : a.endsWith(".testnet") ? "testnet" : qNet === "mainnet" || qNet === "testnet" ? qNet : getNetwork());
/** Where wallets send people back: this page, with the key that was being removed. */
const backUrl = (account: string, network: Network, key?: string) => {
  const u = new URL(location.origin + location.pathname);
  u.searchParams.set("account", account); u.searchParams.set("network", network);
  if (key) u.searchParams.set("removed", key);
  return u.toString();
};

$("form").addEventListener("submit", (e) => { e.preventDefault(); const a = acct(); if (a) void run(a); });
const q = params.get("account");
if (q) { ($("acct") as HTMLInputElement).value = q; void run(q.trim().toLowerCase()); } else idle();

function idle() {
  out.className = "verdict";
  out.innerHTML = `<div class="l"><div class="tagline"><span class="chip idle">READY</span></div><h2 class="h2">${esc(HEALTH_TEXT.heading)}</h2></div><div class="vstage">${stopper("idle")}<span class="cap">GIDEON · WAITING</span></div>`;
}

async function run(account: string) {
  const u = new URL(location.href); u.searchParams.set("account", account);
  for (const k of ["key", "removed", "transactionHashes", "errorCode", "errorMessage"]) u.searchParams.delete(k);
  history.replaceState(null, "", u);
  open = null; ticked = false; last = null; keysEl.innerHTML = ""; wmsg = null;
  const back = removedKey;
  if (back) wmsg = { cls: "safe", text: KEYS_TEXT.sent };
  ($("go") as HTMLButtonElement).disabled = true;
  out.className = "verdict";
  out.innerHTML = `<div class="l"><div class="tagline"><span class="chip idle">CHECKING</span></div><h2 class="h2">Asking the chain…</h2><p class="small mono">${esc(account)}</p></div><div class="vstage">${stopper("idle")}<span class="cap">GIDEON · CHECKING</span></div>`;
  try {
    const network = netFor(account);
    last = await accountHealth({ account, network }, sources(false), { callbackUrl: backUrl(account, network) });
    if (back) {
      const still = last.keys.some((k) => k.publicKey === back);
      wmsg = still ? { cls: "warn", text: KEYS_TEXT.stillThere } : { cls: "safe", text: KEYS_TEXT.removed };
      if (still) open = back;
      removedKey = null;
    }
    if (wantKey && last.keys.some((k) => k.publicKey === wantKey && k.remove)) open = wantKey;
    wantKey = null;
    render(true);
  } catch (e) {
    out.className = "verdict warn";
    out.innerHTML = `<div class="l"><div class="tagline"><span class="chip warn big">COULDN’T CHECK</span></div><h2 class="h2">${esc(e instanceof Error ? e.message : String(e))}</h2></div><div class="vstage">${stopper("warn")}<span class="cap">GIDEON · <b>NOT VERIFIED</b></span></div>`;
  } finally { ($("go") as HTMLButtonElement).disabled = false; }
}

const V = { danger: ["block", "DANGER"], attention: ["warn", "LOOK AGAIN"], clean: ["safe", "CLEAN"], "not-found": ["warn", "NOT FOUND"], "could-not-check": ["warn", "COULDN’T CHECK"] } as const;

function keyRow(r: AccountHealthResult, k: KeyReport): string {
  const red = k.flags.some((f) => f.level === "red");
  const st = red ? ["block", "RED"] : k.tidy ? ["skip", KEYS_TEXT.tidyChip] : k.flags.length ? ["warn", "LOOK"] : ["safe", "OK"];
  const what = k.kind === "full" ? "Full control key" : `App key: ${esc(k.contract)}`;
  const when = k.addedAt ? `Added ${esc(fmtDate(Date.parse(k.addedAt)))}` : esc(HEALTH_TEXT.addedUnknown);
  const chip = (lvl: string) => (lvl === "red" ? ["block", "RED"] : lvl === "tidy" ? ["skip", KEYS_TEXT.tidyChip] : ["warn", "LOOK"]);
  const flags = k.flags.map((f) => { const [c, t] = chip(f.level); return `<li><span class="st ${c}">${t}</span><span>${esc(f.text)}${f.why ? `<br><span class="vnote">${esc(f.why)}</span>` : ""}</span></li>`; }).join("");
  let action = "";
  const plan = k.remove;
  if (plan) {
    if (open === k.publicKey) {
      const locked = k.probableWalletKey && !ticked;
      const link = (href: string, name: string) => locked
        ? `<button class="btn sm ghost" type="button" disabled>${name} ↗</button>`
        : `<a class="btn sm ghost" href="${esc(href)}" target="_blank" rel="noopener">${name} ↗</a>`;
      const who = wstate.accountId;
      const mismatch = !!who && who !== r.account;
      const main = `<button class="btn sm" type="button" data-wallet="1"${locked || wbusy || mismatch ? " disabled" : ""}>${esc(KEYS_TEXT.removeInWallet)}</button>`;
      const status = who
        ? `<p class="${mismatch ? "why" : "vnote"}" style="margin-top:10px">${mismatch ? `<b>${esc(KEYS_TEXT.mismatch(who, r.account))}</b>` : esc(KEYS_TEXT.connected(who, wstate.wallet))}</p>`
        : "";
      const msg = wmsg && open === k.publicKey ? `<p class="${wmsg.cls === "warn" ? "why" : "vnote"}" style="margin-top:10px"><b>${esc(wmsg.text)}</b></p>` : "";
      action = `<div class="go" style="margin-top:12px">
        ${k.probableWalletKey ? `<label class="confirm"><input type="checkbox" id="wk"${ticked ? " checked" : ""}><span><b>${esc(HEALTH_TEXT.walletKey)}</b></span></label>` : ""}
        <p class="why" style="margin-top:10px">${esc(plan.confirm)}</p>
        <div class="actions">${main}${who ? `<button class="btn sm ghost" type="button" data-switch="1"${wbusy ? " disabled" : ""}>${esc(KEYS_TEXT.switchWallet)}</button>` : ""}<button class="btn sm ghost" type="button" data-close="1">Cancel</button></div>
        ${status}${msg}
        <p class="vnote" style="margin-top:10px">${esc(KEYS_TEXT.howSignIn)}</p>
        <p class="vnote" style="margin-top:10px">${esc(KEYS_TEXT.orLinks)}</p>
        <div class="actions">${link(plan.links.meteor, "Open in Meteor")}${plan.links.mynearwallet ? link(plan.links.mynearwallet, "Open in MyNearWallet") : ""}</div></div>`;
    } else {
      action = `<div class="actions" style="margin-top:10px"><button class="btn sm${k.flags.length && !k.tidy ? "" : " ghost"}" type="button" data-rm="${esc(k.publicKey)}">${esc(HEALTH_TEXT.removeButton)}</button></div>`;
    }
  }
  const fullKeys = r.counts.full;
  if (!plan && k.kind === "full" && fullKeys === 1 && k.flags.length) action = `<p class="vnote" style="margin-top:10px">This is the only full control key. Removing it would lock you out.</p>`;
  return `<tr><td style="white-space:normal;overflow-wrap:anywhere;width:100%;font-weight:400"><span class="mono" style="word-break:break-all">${esc(k.publicKey)}</span><br><span class="small">${what} · ${when}${k.uses != null ? ` · used ${k.uses}×` : ""}</span>
    ${k.probableWalletKey ? `<p class="vnote" style="margin-top:6px">${esc(HEALTH_TEXT.walletKey)}</p>` : ""}
    ${flags ? `<ul class="fl" style="margin-top:8px">${flags}</ul>` : ""}${action}</td>
    <td><span class="st ${st[0]}">${st[1]}</span></td></tr>`;
}

async function wallet(network: Network): Promise<RemoveWallet> {
  if (!ws) {
    wbusy = true; wmsg = { cls: "safe", text: KEYS_TEXT.connecting }; render();
    try {
      const { removeWallet } = await import("./remove-wallet");
      ws = await removeWallet(network, (s) => { wstate = s; if (wmsg?.text === KEYS_TEXT.connecting) wmsg = null; render(); });
    } finally { wbusy = false; if (wmsg?.text === KEYS_TEXT.connecting) wmsg = null; render(); }
  }
  return ws;
}

async function removeInWallet() {
  const r = last; const key = open;
  if (!r || !key) return;
  try {
    const w = await wallet(r.network);
    if (!wstate.accountId) { w.connect(); return; }
    if (wstate.accountId !== r.account) { render(); return; }
    wbusy = true; wmsg = null; render();
    await w.removeKey(r.account, key, backUrl(r.account, r.network, key));
    // Injected and app wallets return here; browser wallets leave the page and come back with ?removed=.
    removedKey = key; wbusy = false;
    await run(r.account);
  } catch (e) {
    wbusy = false;
    wmsg = { cls: "warn", text: KEYS_TEXT.failed(e instanceof Error ? e.message : String(e)) };
    render();
  }
}

function render(play = false) {
  const r = last;
  if (!r) return;
  const [v, chip] = V[r.status];
  out.className = `verdict ${v}`;
  out.innerHTML = `<div class="l"><div class="tagline"><span class="chip big ${v}">${chip}</span></div>
    <h2 class="h2">${esc(r.summary)}</h2>
    ${r.advice ? `<p class="why" style="margin-top:12px"><b>${esc(r.advice)}</b></p>` : ""}
    <div class="meta"><span>NEAR ${esc(r.network)}</span><span>${r.ms} ms</span><span>${r.counts.full} full · ${r.counts.app} app</span>${r.counts.tidy ? `<span>${r.counts.tidy} to tidy</span>` : ""}</div>
    ${r.notes.map((n) => `<p class="vnote" style="margin-top:8px">${esc(n)}</p>`).join("")}
    <p class="vnote" style="margin-top:12px"><a href="${esc(r.explorerUrl)}" target="_blank" rel="noopener">NearBlocks ↗</a></p></div>
    <div class="vstage">${stopper(play ? "idle" : v)}<span class="cap">GIDEON · <b>${esc(r.account)}</b></span></div>`;
  if (play) void playVerdict(out.querySelector(".vstage .gs"), v);
  if (!r.keys.length) { keysEl.innerHTML = ""; return; }
  const main = r.keys.filter((k) => !k.tidy), tidy = r.keys.filter((k) => k.tidy);
  const top = wmsg && !(open && r.keys.some((k) => k.publicKey === open)) ? `<p class="${wmsg.cls === "warn" ? "why" : "vnote"}" style="margin-top:24px"><b>${esc(wmsg.text)}</b></p>` : "";
  keysEl.innerHTML = `${top}${main.length ? `<div class="panel" style="margin-top:24px"><div class="hd"><span class="lbl">Keys</span><span class="lbl">${r.counts.flagged} flagged</span></div><div class="bd">
    <table class="tbl">${main.map((k) => keyRow(r, k)).join("")}</table></div></div>` : ""}
    ${tidy.length ? `<div class="panel" style="margin-top:24px"><div class="hd"><span class="lbl">${esc(HEALTH_TEXT.tidyHeading)}</span><span class="lbl">${tidy.length}</span></div><div class="bd">
    <p class="vnote" style="margin-bottom:10px">${esc(HEALTH_TEXT.tidyNote)}</p>
    <table class="tbl">${tidy.map((k) => keyRow(r, k)).join("")}</table></div></div>` : ""}`;
  keysEl.querySelectorAll<HTMLElement>("[data-rm]").forEach((b) => b.addEventListener("click", () => { open = b.dataset.rm!; ticked = false; wmsg = null; render(); }));
  keysEl.querySelector("[data-wallet]")?.addEventListener("click", () => void removeInWallet());
  keysEl.querySelector("[data-switch]")?.addEventListener("click", () => { void wallet(r.network).then((w) => w.switchWallet()); });
  keysEl.querySelector("[data-close]")?.addEventListener("click", () => { open = null; ticked = false; render(); });
  $("wk")?.addEventListener("change", (e) => { ticked = (e.target as HTMLInputElement).checked; render(); });
}
