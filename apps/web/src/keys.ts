import { accountHealth, deleteKeyLinks, fmtDate, HEALTH_TEXT, type AccountHealthResult, type KeyReport, type Network } from "@gideon/core";
import { initChrome, stopper, esc, footer, playVerdict } from "./chrome";
import { getNetwork } from "./state";
import { sources } from "./run";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const out = $("out"), keysEl = $("keys");
let last: AccountHealthResult | null = null;
/** The key whose remove step is open, and whether its wallet-key warning box is ticked. */
let open: string | null = null;
let ticked = false;

initChrome("Account health", () => { const a = acct(); if (a) void run(a); });
$("heading").textContent = HEALTH_TEXT.heading;
$("footnote").textContent = HEALTH_TEXT.footer;
$("foot").innerHTML = footer("GIDEON · account health");

const acct = () => ($("acct") as HTMLInputElement).value.trim().toLowerCase();
/** .near is mainnet and .testnet is testnet; other names (implicit accounts) follow the site's network switch. */
const netFor = (a: string): Network => (a.endsWith(".near") ? "mainnet" : a.endsWith(".testnet") ? "testnet" : getNetwork());

$("form").addEventListener("submit", (e) => { e.preventDefault(); const a = acct(); if (a) void run(a); });
const q = new URLSearchParams(location.search).get("account");
if (q) { ($("acct") as HTMLInputElement).value = q; void run(q.trim().toLowerCase()); } else idle();

function idle() {
  out.className = "verdict";
  out.innerHTML = `<div class="l"><div class="tagline"><span class="chip idle">READY</span></div><h2 class="h2">${esc(HEALTH_TEXT.heading)}</h2></div><div class="vstage">${stopper("idle")}<span class="cap">GIDEON · WAITING</span></div>`;
}

async function run(account: string) {
  const u = new URL(location.href); u.searchParams.set("account", account); history.replaceState(null, "", u);
  open = null; ticked = false; last = null; keysEl.innerHTML = "";
  ($("go") as HTMLButtonElement).disabled = true;
  out.className = "verdict";
  out.innerHTML = `<div class="l"><div class="tagline"><span class="chip idle">CHECKING</span></div><h2 class="h2">Asking the chain…</h2><p class="small mono">${esc(account)}</p></div><div class="vstage">${stopper("idle")}<span class="cap">GIDEON · CHECKING</span></div>`;
  try {
    last = await accountHealth({ account, network: netFor(account) }, sources(false));
    render(true);
  } catch (e) {
    out.className = "verdict warn";
    out.innerHTML = `<div class="l"><div class="tagline"><span class="chip warn big">COULDN’T CHECK</span></div><h2 class="h2">${esc(e instanceof Error ? e.message : String(e))}</h2></div><div class="vstage">${stopper("warn")}<span class="cap">GIDEON · <b>NOT VERIFIED</b></span></div>`;
  } finally { ($("go") as HTMLButtonElement).disabled = false; }
}

const V = { danger: ["block", "DANGER"], attention: ["warn", "LOOK AGAIN"], clean: ["safe", "CLEAN"], "not-found": ["warn", "NOT FOUND"], "could-not-check": ["warn", "COULDN’T CHECK"] } as const;

function keyRow(r: AccountHealthResult, k: KeyReport, fullKeys: number): string {
  const red = k.flags.some((f) => f.level === "red");
  const st = red ? ["block", "RED"] : k.flags.length ? ["warn", "LOOK"] : ["safe", "OK"];
  const what = k.kind === "full" ? "Full control key" : `App key: ${esc(k.contract)}`;
  const when = k.addedAt ? `Added ${esc(fmtDate(Date.parse(k.addedAt)))}` : esc(HEALTH_TEXT.addedUnknown);
  const only = k.kind === "full" && fullKeys === 1;
  const flags = k.flags.map((f) => `<li><span class="st ${f.level === "red" ? "block" : "warn"}">${f.level === "red" ? "RED" : "LOOK"}</span><span>${esc(f.text)}${f.why ? `<br><span class="vnote">${esc(f.why)}</span>` : ""}</span></li>`).join("");
  let action = "";
  if (k.removable && !only) {
    if (open === k.publicKey) {
      const wallet = r.keys.find((x) => x.probableWalletKey && x.publicKey !== k.publicKey)?.publicKey;
      const l = deleteKeyLinks(r.network, r.account, k.publicKey, wallet ? { walletKey: wallet } : {});
      const locked = k.probableWalletKey && !ticked;
      const link = (href: string, name: string) => locked
        ? `<button class="btn sm" type="button" disabled>${name} ↗</button>`
        : `<a class="btn sm" href="${esc(href)}" target="_blank" rel="noopener">${name} ↗</a>`;
      action = `<div class="go" style="margin-top:12px">
        ${k.probableWalletKey ? `<label class="confirm"><input type="checkbox" id="wk"${ticked ? " checked" : ""}><span><b>${esc(HEALTH_TEXT.walletKey)}</b></span></label>` : ""}
        <p class="why" style="margin-top:10px">${esc(l.confirm)}</p>
        <div class="actions">${link(l.meteor, "Open in Meteor")}${l.mynearwallet ? link(l.mynearwallet, "Open in MyNearWallet") : ""}<button class="btn sm ghost" type="button" data-close="1">Cancel</button></div></div>`;
    } else {
      action = `<div class="actions" style="margin-top:10px"><button class="btn sm${k.flags.length ? "" : " ghost"}" type="button" data-rm="${esc(k.publicKey)}">${esc(HEALTH_TEXT.removeButton)}</button></div>`;
    }
  }
  if (only && k.flags.length) action = `<p class="vnote" style="margin-top:10px">This is the only full control key. Removing it would lock you out.</p>`;
  return `<tr><td style="white-space:normal;overflow-wrap:anywhere;width:100%;font-weight:400"><span class="mono" style="word-break:break-all">${esc(k.publicKey)}</span><br><span class="small">${what} · ${when}${k.uses != null ? ` · used ${k.uses}×` : ""}</span>
    ${k.probableWalletKey ? `<p class="vnote" style="margin-top:6px">${esc(HEALTH_TEXT.walletKey)}</p>` : ""}
    ${flags ? `<ul class="fl" style="margin-top:8px">${flags}</ul>` : ""}${action}</td>
    <td><span class="st ${st[0]}">${st[1]}</span></td></tr>`;
}

function render(play = false) {
  const r = last;
  if (!r) return;
  const [v, chip] = V[r.status];
  out.className = `verdict ${v}`;
  out.innerHTML = `<div class="l"><div class="tagline"><span class="chip big ${v}">${chip}</span></div>
    <h2 class="h2">${esc(r.summary)}</h2>
    ${r.advice ? `<p class="why" style="margin-top:12px"><b>${esc(r.advice)}</b></p>` : ""}
    <div class="meta"><span>NEAR ${esc(r.network)}</span><span>${r.ms} ms</span><span>${r.counts.full} full · ${r.counts.app} app</span></div>
    ${r.notes.map((n) => `<p class="vnote" style="margin-top:8px">${esc(n)}</p>`).join("")}
    <p class="vnote" style="margin-top:12px"><a href="${esc(r.explorerUrl)}" target="_blank" rel="noopener">NearBlocks ↗</a></p></div>
    <div class="vstage">${stopper(play ? "idle" : v)}<span class="cap">GIDEON · <b>${esc(r.account)}</b></span></div>`;
  if (play) void playVerdict(out.querySelector(".vstage .gs"), v);
  if (!r.keys.length) { keysEl.innerHTML = ""; return; }
  const fullKeys = r.keys.filter((k) => k.kind === "full").length;
  keysEl.innerHTML = `<div class="panel" style="margin-top:24px"><div class="hd"><span class="lbl">Keys</span><span class="lbl">${r.counts.flagged} flagged</span></div><div class="bd">
    <table class="tbl">${r.keys.map((k) => keyRow(r, k, fullKeys)).join("")}</table></div></div>`;
  keysEl.querySelectorAll<HTMLElement>("[data-rm]").forEach((b) => b.addEventListener("click", () => { open = b.dataset.rm!; ticked = false; render(); }));
  keysEl.querySelector("[data-close]")?.addEventListener("click", () => { open = null; ticked = false; render(); });
  $("wk")?.addEventListener("change", (e) => { ticked = (e.target as HTMLInputElement).checked; render(); });
}
