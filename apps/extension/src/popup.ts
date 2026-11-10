import { exchangesFor, tokensFor, type AccountHealthResult, type CheckInput, type Contact, type Network } from "@gideon/core";
import { isAccount, rememberAccount } from "./lib/sender.js";
import { plainTrim } from "./lib/detect.js";
import { addContact, load, removeContact, saveContacts, saveSettings, type LastCheck, type Settings } from "./lib/settings.js";
import { sendCheck, sendDrainer, sendHealth, type CheckRequest } from "./lib/messages.js";
import { drainerWanted, drainerFailedFinding, VERDICT_TEXT, withDrainer } from "@gideon/core";
import { LIMITS } from "./lib/limits.js";
import { missingOptional } from "./lib/runcache.js";
import type { NetworkMode } from "./lib/network.js";
import { card, checking, esc, failed, healthCard, LOGO, short, type HealthUi } from "./lib/view.js";
import { STYLE, STYLE_WARN_FIX } from "./lib/style.js";
import { POPUP_STYLE } from "./lib/popup-style.js";
import { asMode, loadTheme, MODES, saveTheme, themeOf, type Mode } from "./lib/shift.js";
import { playAll } from "./lib/motion.js";

const css = document.createElement("style");
css.textContent = STYLE + STYLE_WARN_FIX + POPUP_STYLE;
document.head.appendChild(css);

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const net = $<HTMLSelectElement>("net");
const asset = $<HTMLSelectElement>("asset");
const dest = $<HTMLSelectElement>("dest");
const exSel = $<HTMLSelectElement>("exchange");
let contacts: Contact[] = [];

$("logo").innerHTML = LOGO;

/* ---------- light / dark, or the system setting ---------- */
const app = $("app");
const rail = $("themerail");
rail.innerHTML = MODES.map(([s, t]) => `<button type="button" role="radio" data-m="${s}" aria-checked="false"${s === "system" ? ' title="Follow this device’s setting"' : ""}>${t}</button>`).join("");
function applyTheme(m: Mode): void {
  const t = themeOf(m);
  app.dataset.theme = t;
  app.dataset.mode = m;
  document.documentElement.dataset.theme = t;
  document.documentElement.dataset.mode = m;
  rail.querySelectorAll("button").forEach((b) => { b.setAttribute("aria-checked", String(b.dataset.m === m)); b.tabIndex = b.dataset.m === m ? 0 : -1; });
  try { localStorage.setItem("gideon:theme", m); } catch { /* fine */ }
}
let cached: Mode = "system";
try {
  const saved = localStorage.getItem("gideon:theme");
  cached = saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
} catch { /* fine */ }
applyTheme(cached);
void loadTheme().then((m) => { if (m !== cached) applyTheme(m); });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (app.dataset.mode === "system") applyTheme("system"); });
rail.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (!b) return;
  const m = asMode(b.dataset.m);
  applyTheme(m);
  void saveTheme(m);
});
rail.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const list = MODES.map(([s]) => s);
  const cur = list.indexOf(asMode(app.dataset.mode ?? rail.querySelector('[aria-checked="true"]')?.getAttribute("data-m")));
  const next = list[(cur + (e.key === "ArrowRight" ? 1 : list.length - 1)) % list.length]!;
  applyTheme(next); void saveTheme(next);
  (rail.querySelector(`[data-m="${next}"]`) as HTMLElement).focus();
});
$("ver").textContent = `v${chrome.runtime.getManifest().version}`;

/**
 * Asset options carry their network ("mainnet|USDT|usdt.tether-token.near"), so in Auto a token
 * you pick also tells Gideon the network. Native NEAR has none: Auto then goes by the address.
 */
function fillForNetwork(n: NetworkMode): void {
  net.value = n;
  net.parentElement!.classList.toggle("main", n === "mainnet");
  const nets: Network[] = n === "auto" ? ["mainnet", "testnet"] : [n];
  asset.innerHTML =
    `<option value="|NEAR|">NEAR (native)</option>` +
    nets.flatMap((m) => tokensFor(m).map((t) => `<option value="${m}|${esc(t.symbol)}|${esc(t.contract)}">${esc(t.symbol)}${t.kind === "bridged" ? " (bridged)" : ""}${n === "auto" ? ` · ${m}` : ""}</option>`)).join("");
  exSel.innerHTML = exchangesFor(n === "auto" ? "mainnet" : n).map((e) => `<option value="${esc(e.id)}">${esc(e.name)}${e.verified ? "" : " (unverified)"}</option>`).join("");
}
dest.addEventListener("change", () => exSel.classList.toggle("hidden", dest.value !== "exchange"));

function renderLast(l: LastCheck | null): void {
  if (!l) {
    $("last").innerHTML = `Nothing checked on a page yet. Paste an address into a send or withdrawal form and Gideon checks it there.`;
    return;
  }
  const tone = l.verdict === "BLOCKED" ? "block" : l.verdict === "SAFE" ? "safe" : "warn";
  const label = l.verdict === "BLOCKED" ? "STOPPED" : l.verdict === "SAFE" ? VERDICT_TEXT.safeChip : l.couldNotCheck ? "COULDN’T CHECK" : "LOOK AGAIN";
  const when = new Date(l.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("last").innerHTML = `<div class="h"><span>${esc(l.host || "this browser")} · ${esc(when)}</span><span class="chip ${tone}">${label}</span></div>
<div class="mono">${esc(short(l.to))}</div><div class="t">${esc(l.title)}</div>`;
}

function renderContacts(): void {
  $("ccount").textContent = String(contacts.length);
  $("sSaved").textContent = String(contacts.length);
  $("clist").innerHTML = contacts.length
    ? contacts.map((c, i) => `<li><span>${esc(c.account)}${c.label ? ` · <b>${esc(c.label)}</b>` : ""}</span><button type="button" data-i="${i}" aria-label="Remove ${esc(c.account)}">remove</button></li>`).join("")
    : `<li><span class="hint">No saved addresses yet.</span></li>`;
}

let mine: string[] = [];
function renderMine(): void {
  $("mcount").textContent = String(mine.length);
  $("mlist").innerHTML = mine.length
    ? mine.map((a, i) => `<li><span>${esc(a)}</span><button type="button" data-i="${i}" aria-label="Remove ${esc(a)}">remove</button></li>`).join("")
    : `<li><span class="hint">None yet. Gideon asks before it adds one.</span></li>`;
}
$("mlist").addEventListener("click", (e) => {
  const i = (e.target as HTMLElement).dataset.i;
  if (i === undefined) return;
  mine = mine.filter((_, j) => j !== +i);
  void chrome.storage.local.set({ myAccounts: mine });
  renderMine();
});
$("madd").addEventListener("click", () => {
  const box = $<HTMLInputElement>("macc");
  const a = box.value.trim().toLowerCase().replace(/^@/, "");
  if (!a) return;
  if (!isAccount(a)) {
    box.setCustomValidity("Type a full account name, like you.near or you.testnet, or a 64-character hex account");
    box.reportValidity();
    return;
  }
  box.setCustomValidity("");
  mine = rememberAccount(mine, a);
  void chrome.storage.local.set({ myAccounts: mine });
  box.value = "";
  renderMine();
});

async function init(): Promise<void> {
  const s = await load();
  contacts = s.contacts;
  mine = s.myAccounts;
  renderMine();
  if (mine[0] && !$<HTMLInputElement>("hacc").value) $<HTMLInputElement>("hacc").value = mine[0];
  fillForNetwork(s.settings.networkMode);
  for (const k of ["checkOnPaste", "holdSend", "clipboardCheck"] as const) {
    const box = $<HTMLInputElement>(k);
    box.checked = s.settings[k];
    box.addEventListener("change", () => void saveSettings({ [k]: box.checked } as Partial<Settings>));
  }
  $("sChecked").textContent = String(s.stats.checked);
  $("sStopped").textContent = String(s.stats.stopped);
  renderLast(s.last);
  renderContacts();
}

net.addEventListener("change", () => {
  const n = net.value as NetworkMode;
  fillForNetwork(n);
  void saveSettings({ networkMode: n });
  $("result").innerHTML = "";
});

$("clist").addEventListener("click", (e) => {
  const i = (e.target as HTMLElement).dataset.i;
  if (i === undefined) return;
  contacts = removeContact(contacts, contacts[+i]!.account);
  void saveContacts(contacts);
  renderContacts();
});
$("cadd").addEventListener("click", () => {
  const acc = $<HTMLInputElement>("cacc").value.trim();
  if (!acc) return;
  contacts = addContact(contacts, acc, $<HTMLInputElement>("clab").value.trim() || undefined);
  void saveContacts(contacts);
  $<HTMLInputElement>("cacc").value = "";
  $<HTMLInputElement>("clab").value = "";
  renderContacts();
});

$<HTMLFormElement>("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const to = plainTrim($<HTMLInputElement>("to").value);
  if (!to) return;
  const [tokenNet, symbol, contract] = asset.value.split("|");
  const mode = net.value as NetworkMode;
  const chosen = mode !== "auto" ? mode : (tokenNet as Network | "") || undefined;
  const input: CheckRequest["input"] = {
    to,
    ...(chosen ? { network: chosen } : {}),
    asset: { symbol: symbol!, ...(contract ? { contract } : {}) },
    destination: dest.value as CheckInput["destination"],
    ...(dest.value === "exchange" ? { exchange: exSel.value } : {}),
    ...($<HTMLInputElement>("amount").value.trim() ? { amount: $<HTMLInputElement>("amount").value.trim() } : {}),
  };
  const go = $<HTMLButtonElement>("go");
  const asked = ++drainerSeq;
  go.disabled = true;
  go.firstChild!.textContent = "Checking live NEAR data… ";
  $("result").innerHTML = checking(to);
  const res = await sendCheck({ input, host: "" }).catch((err: unknown) => ({ ok: false as const, error: String(err) }));
  go.disabled = false;
  go.firstChild!.textContent = "Check this send ";
  const pending = !!res?.ok && drainerWanted(res.result);
  const netOpt = res?.ok && res.net ? { net: res.net } : {};
  $("result").innerHTML = res?.ok ? card(res.result, { ...netOpt, ...(pending ? { drainerPending: true } : {}) }) : failed(res?.error ?? "The extension didn't answer.");
  playAll($("result"));
  const showStats = async () => {
    const s = await load();
    $("sChecked").textContent = String(s.stats.checked);
    $("sStopped").textContent = String(s.stats.stopped);
  };
  await showStats();
  if (!res?.ok) return;
  let shown = res.result;
  // The verdict shows first; the drained-wallet check (R18) then updates the card, or leaves it as is.
  const drained = (async () => {
    if (!pending) return;
    const merged = await sendDrainer(res.result, LIMITS.drainerWaitMs);
    if (asked !== drainerSeq) return; // a newer check replaced this one
    shown = merged ?? await withDrainer(res.result, drainerFailedFinding());
    $("result").innerHTML = card(shown, { ...netOpt, ...(merged ? {} : { drainerFailed: true }) });
    if (shown.verdict !== res.result.verdict) playAll($("result"));
    await showStats();
  })();
  // Same as the card on a page: if only the creation date missed the time limit, ask once more in a
  // moment (the worker remembers the lookups) and fill it in quietly, keeping the drained-wallet answer.
  if (missingOptional(res.result)) {
    setTimeout(async () => {
      if (asked !== drainerSeq) return;
      const again = await sendCheck({ input, host: "", refill: true }).catch(() => null);
      if (!again?.ok || asked !== drainerSeq) return;
      await drained;
      if (asked !== drainerSeq) return;
      const r18 = shown.findings.some((f) => f.rule === "R18" && f.status !== "SKIPPED");
      if (r18) {
        const filled = await sendDrainer(again.result, LIMITS.drainerWaitMs);
        if (asked !== drainerSeq) return;
        shown = filled ?? await withDrainer(again.result, drainerFailedFinding());
      } else {
        shown = again.result;
      }
      $("result").innerHTML = card(shown, again.net ? { net: again.net } : netOpt);
    }, LIMITS.refillAfterMs);
  }
});
let drainerSeq = 0;

/* ---------- Check my account (read-only; links open the wallet, which signs) ---------- */
let health: AccountHealthResult | null = null;
let hui: HealthUi = {};
let healthSeq = 0;
function showHealth(): void {
  if (!health) return;
  $("hres").innerHTML = healthCard(health, hui);
}
$("hres").addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const rm = t.closest<HTMLElement>("[data-rm]");
  if (rm) { hui = { open: rm.dataset.rm!, ticked: false }; showHealth(); return; }
  if (t.closest("[data-close]")) { hui = {}; showHealth(); }
});
$("hres").addEventListener("change", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.dataset.tick) { hui = { ...hui, ticked: t.checked }; showHealth(); }
});
$<HTMLFormElement>("hf").addEventListener("submit", async (e) => {
  e.preventDefault();
  const box = $<HTMLInputElement>("hacc");
  const account = box.value.trim().toLowerCase().replace(/^@/, "");
  if (!account) return;
  if (!isAccount(account)) {
    box.setCustomValidity("Type a full account name, like you.near or you.testnet, or a 64-character hex account");
    box.reportValidity();
    return;
  }
  box.setCustomValidity("");
  // .near is mainnet and .testnet is testnet; other names follow the network switch (Auto: mainnet).
  const network: Network = account.endsWith(".near") ? "mainnet" : account.endsWith(".testnet") ? "testnet" : net.value === "testnet" ? "testnet" : "mainnet";
  const asked = ++healthSeq;
  health = null; hui = {};
  const go = $<HTMLButtonElement>("hgo");
  go.disabled = true;
  $("hres").innerHTML = checking(account);
  const res = await sendHealth({ account, network });
  go.disabled = false;
  if (asked !== healthSeq) return;
  if (!res.ok) { $("hres").innerHTML = failed(res.error); return; }
  health = res.result;
  showHealth();
  playAll($("hres"));
});

void init();
