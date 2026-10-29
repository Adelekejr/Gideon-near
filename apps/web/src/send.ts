import type { CheckResult, Finding, Status } from "@gideon/core";
import { NETWORKS, explorerTxUrl } from "@gideon/core";
import { initChrome, stopper, esc, footer } from "./chrome";
import { runCheck } from "./run";
import { getContacts } from "./state";
import { gate, nearToYocto, sendKey, sendNetwork, type GateKind } from "./sendgate";
import { connector, sendNear, type Connected } from "./wallet";

/** Signing network: config only (VITE_GIDEON_SEND_NETWORK), testnet by default. */
const NET = sendNetwork(import.meta.env.VITE_GIDEON_SEND_NETWORK);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let who: Connected | null = null;
let checking = false;
let checked: { key: string; result: CheckResult } | null = null;
let checkError: string | null = null;
let confirmed = false;
let sending = false;
let sent: { key: string; hash?: string } | null = null;
let sendError: string | null = null;

initChrome("Send", () => note(`The site’s network switch doesn’t change sending. This page signs on NEAR ${NET} (set by VITE_GIDEON_SEND_NETWORK).`));
$("netbadge").className = `netbadge ${NET}`;
$("netbadge").textContent = NET === "mainnet" ? "NEAR mainnet · real funds" : "NEAR testnet";
$("to").setAttribute("placeholder", `someone${NETWORKS[NET].accountSuffix}`);
$("foot").innerHTML = footer(`GIDEON · check, then send · NEAR ${NET}`);

const nc = connector(NET, (c) => { who = c; reset(); });

const to = () => ($("to") as HTMLInputElement).value.trim();
const amount = () => ($("amount") as HTMLInputElement).value.trim();
function yocto(): string | null { try { return nearToYocto(amount()); } catch { return null; } }
const key = () => sendKey(NET, who?.accountId ?? "", to(), amount());
function reset() { confirmed = false; sendError = null; checkError = null; update(); }

$("to").addEventListener("input", reset);
$("amount").addEventListener("input", reset);
$("form").addEventListener("submit", (e) => { e.preventDefault(); void doCheck(); });

let noteText = "";
function note(t: string) { noteText = t; update(); }

async function doCheck() {
  const g = current();
  if (!g.canCheck || !who) return;
  const k = key();
  checking = true; checkError = null; update();
  try {
    const book = getContacts();
    const result = await runCheck({ to: to(), network: NET, amount: amount(), asset: { symbol: "NEAR" }, destination: "wallet", from: who.accountId, ...(book.length ? { addressBook: book } : {}) });
    checked = { key: k, result };
  } catch (e) {
    checked = null;
    checkError = e instanceof Error ? e.message : String(e);
  } finally { checking = false; update(); }
}

async function doSend() {
  const g = current();
  const y = yocto();
  if (!g.canSend || !who || !y || !checked) return;
  const k = key();
  // Send exactly the account that was checked.
  const receiver = checked.result.classification.normalized;
  sending = true; sendError = null; update();
  try {
    const hash = await sendNear(nc, who.accountId, receiver, y);
    sent = { key: k, hash };
  } catch (e) {
    sendError = e instanceof Error ? e.message : String(e);
  } finally { sending = false; update(); }
}

function current() {
  return gate({
    account: who?.accountId ?? null, key: key(), amountOk: yocto() !== null, to: to(), checking,
    checked: checked ? { key: checked.key, verdict: checked.result.verdict } : null,
    confirmed, sending, sentKey: sent?.key ?? null,
  });
}

const ST: Record<Status, [string, string]> = { BLOCKED: ["block", "BLOCK"], ATTENTION: ["warn", "LOOK"], PASS: ["safe", "PASS"], COULD_NOT_CHECK: ["cnc", "COULDN’T"], SKIPPED: ["", ""] };
function findingsList(r: CheckResult): string {
  const bad = r.findings.filter((f: Finding) => f.status === "BLOCKED" || f.status === "ATTENTION" || f.status === "COULD_NOT_CHECK");
  const list = bad.length ? bad : r.findings.filter((f) => f.status === "PASS");
  return `<ul class="fl">${list.slice(0, 4).map((f) => `<li><span class="st ${ST[f.status][0]}">${ST[f.status][1]}</span><span>${esc(f.title)}</span></li>`).join("")}</ul>`;
}

function update() {
  const g = current();
  const r = checked && checked.key === key() ? checked.result : null;
  const amt = amount();
  const target = to();
  const conn = !!who;

  // Wallet card
  $("wallet").innerHTML = who
    ? `<div class="wal"><div><span class="label">Connected · ${esc(who.wallet)}</span><div class="addr">${esc(who.accountId)}</div></div><button class="btn sm ghost" id="disc" type="button">Disconnect</button></div>`
    : `<div class="wal"><span class="small">No wallet connected. Meteor, HOT, Intear and other NEAR wallets work.</span><button class="btn sm" id="conn" type="button">Connect wallet</button></div>`;
  $("conn")?.addEventListener("click", () => nc.connect().catch((e) => note(`Wallet didn’t connect: ${e?.message ?? e}`)));
  $("disc")?.addEventListener("click", () => nc.disconnect().catch(() => {}));
  ($("to") as HTMLInputElement).disabled = !conn;
  ($("amount") as HTMLInputElement).disabled = !conn;
  ($("checkbtn") as HTMLButtonElement).disabled = !g.canCheck;
  $("checkbtn").firstChild!.textContent = g.kind === "checking" ? "Checking… " : r ? "Check again " : "Check this send ";
  $("amterr").textContent = amt && yocto() === null ? (() => { try { nearToYocto(amt); return ""; } catch (e) { return (e as Error).message; } })() : "";

  // Steps
  const step = g.kind === "connect" ? 1 : ["fill", "check", "checking"].includes(g.kind) ? 2 : 3;
  document.querySelectorAll<HTMLElement>("#steps li").forEach((li) => {
    const s = Number(li.dataset.s);
    li.className = s === step ? "on" : s < step || g.kind === "sent" ? "done" : "";
  });

  // Gate panel
  const v: Record<GateKind, "idle" | "safe" | "warn" | "block"> = { connect: "idle", fill: "idle", check: "idle", checking: "idle", safe: "safe", attention: "warn", blocked: "block", sending: "safe", sent: "safe" };
  let vk = v[g.kind];
  if (g.kind === "sending" && r) vk = r.verdict === "SAFE" ? "safe" : "warn";
  const h = r?.headline ?? null;
  const cnc = h?.status === "COULD_NOT_CHECK";
  const sum = `${esc(amt)} NEAR → ${esc(target)}`;
  let chip = "", title = "", why = "", body = "", tag = "WAITING";
  switch (g.kind) {
    case "connect": chip = `<span class="chip idle">NOT CONNECTED</span>`; title = "Connect a wallet to start."; why = `Gideon checks the send first. Your wallet signs it only after that, on NEAR ${NET}.`; break;
    case "fill": chip = `<span class="chip idle">READY</span>`; title = "Who are you paying, and how much?"; why = "Paste the receiver’s NEAR account and an amount. Then run the check."; break;
    case "check": chip = `<span class="chip idle">NOT CHECKED</span>`; title = "Check before you send."; why = checkError ? `The last check didn’t finish (${esc(checkError)}). That isn’t a pass. Try again.` : `${sum}. The Send button stays locked until Gideon has checked exactly this.`; break;
    case "checking": chip = `<span class="chip idle">CHECKING</span>`; title = "Asking the chain…"; why = sum; tag = "CHECKING"; break;
    case "safe": chip = `<span class="chip safe">SAFE TO SEND</span>`; title = "Looks right. Every check that applies passed."; why = `${sum}. Read from live NEAR ${NET} data just now.`; tag = "<b>PASSED</b>"; break;
    case "attention": chip = `<span class="chip warn">${cnc ? "COULDN’T CHECK" : "LOOK AGAIN"}</span>`; title = h?.title ?? "Look again before you send."; why = esc(h?.detail ?? ""); tag = `<b>${cnc ? "NOT VERIFIED" : "HELD FOR REVIEW"}</b>`; break;
    case "blocked": chip = `<span class="chip block">BLOCKED</span>`; title = h?.title ?? "Don’t send this."; why = esc(h?.detail ?? ""); tag = "<b>BOUNCED</b>"; break;
    case "sending": chip = `<span class="chip idle">IN YOUR WALLET</span>`; title = "Approve the transfer in your wallet."; why = `${sum}. Gideon is waiting for your wallet.`; tag = "SIGNING"; break;
    case "sent": chip = `<span class="chip safe">SENT</span>`; title = "Sent. Your wallet signed it after the check."; why = sum; tag = "<b>DELIVERED</b>"; break;
  }
  if (r && ["safe", "attention", "blocked"].includes(g.kind)) {
    const report = new URLSearchParams({ to: target, amount: amt, from: who?.accountId ?? "", net: NET, dest: "wallet" });
    body = `<div class="meta"><span>NEAR ${esc(NET)}</span><span>${r.ms} ms</span><span>${r.sources.length} lookups</span><span>verdict ${esc(r.verdict)}</span></div>${findingsList(r)}
     <p class="note" style="margin-top:12px"><a href="check.html?${esc(report.toString())}" target="_blank" rel="noopener">Full report ↗</a></p>`;
  }
  if (g.kind === "sent" && sent?.hash) body = `<p class="note" style="margin-top:14px">Transaction <a href="${esc(explorerTxUrl(NET, sent.hash))}" target="_blank" rel="noopener">${esc(sent.hash)} ↗</a></p>`;

  const sendLabel = { safe: "Send", attention: "Send anyway", blocked: "Send blocked", sending: "Waiting for wallet…", sent: "Sent" } as Record<string, string>;
  const btnCls = g.kind === "blocked" ? "block" : g.kind === "attention" ? "warn" : "safe";
  const label = sendLabel[g.kind] ? `${sendLabel[g.kind]}${["safe", "attention"].includes(g.kind) ? ` ${esc(amt)} NEAR` : ""}` : "Send (check first)";
  const go = `<div class="go">
   ${g.showConfirm ? `<label class="confirm"><input type="checkbox" id="ok"${confirmed ? " checked" : ""}><span>I read why Gideon flagged this and I still want to send ${esc(amt)} NEAR to <b class="mono">${esc(target)}</b>.</span></label>` : ""}
   <button class="btn sendbtn ${btnCls}" id="send" type="button"${g.canSend ? "" : " disabled"}>${label}</button>
   ${g.kind === "blocked" ? `<p class="note">Blocked sends can’t be overridden here. Fix the address and check again.</p>` : ""}
   ${sendError ? `<p class="note" style="color:#FF8A63">Not sent: ${esc(sendError)}</p>` : ""}
   ${noteText ? `<p class="note">${esc(noteText)}</p>` : ""}
  </div>`;

  const el = $("gate");
  el.className = `verdict ${vk === "idle" ? "" : vk} crop${el.classList.contains("zn") ? " zn" : ""}`;
  el.querySelectorAll(":scope > .l, :scope > .r").forEach((n) => n.remove());
  el.insertAdjacentHTML("beforeend", `<div class="l"><div>${chip}</div><h2 class="h2">${esc(title)}</h2><p class="why">${why}</p>${body}${go}</div>
   <div class="r">${stopper(vk === "safe" ? "safe" : vk === "idle" ? "idle" : "block")}<span class="tag">GIDEON · ${tag}</span></div>`);
  $("ok")?.addEventListener("change", (e) => { confirmed = (e.target as HTMLInputElement).checked; update(); });
  $("send")?.addEventListener("click", () => void doSend());
}

update();
