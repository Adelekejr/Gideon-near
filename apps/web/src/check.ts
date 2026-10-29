import { explain, explorerAccountUrl, type CheckResult, type Finding, type Status } from "@gideon/core";
import { initChrome, stopper, esc, footer } from "./chrome";
import { getNetwork } from "./state";
import { inputFromQuery, runCheck, CASES } from "./run";

const RULE_NAMES: Record<string, string> = {
  R1: "Format & network", R2: "Pasted hash", R3: "Account on chain", R4: "Ethereum-style account", R5: "Token",
  R6: "Intents deposit", R7: "Lookalike", R8: "Exchange rules", R9: "Clipboard", R10: "Community registry",
};
const ST: Record<Status, [string, string]> = {
  BLOCKED: ["block", "BLOCK"], ATTENTION: ["warn", "LOOK"], PASS: ["safe", "PASS"], COULD_NOT_CHECK: ["cnc", "COULDN’T CHECK"], SKIPPED: ["skip", "—"],
};

const out = document.getElementById("out")!;
const q = new URLSearchParams(location.search);
const { input, replay } = inputFromQuery(q, getNetwork());

initChrome("Checker", () => location.reload());
document.getElementById("loading")!.innerHTML = `${stopper("idle")}<div><span class="label">Checking on NEAR ${esc(input.network)}${replay ? " · recorded answers" : " · live"}</span><div class="h2" style="margin-top:6px">Asking the chains…</div><p class="small mono" style="margin-top:6px">${esc(input.to || "(empty)")}</p></div>`;

if (!input.to.trim() && !q.get("example")) {
  location.replace("index.html");
} else {
  runCheck(input, replay).then(render, (e) => {
    out.innerHTML = `<section class="verdict warn crop"><div class="l"><span class="chip warn">COULDN’T CHECK</span><h1 class="h1">Gideon couldn’t finish this check.</h1><p class="why">${esc(e?.message ?? e)}</p><p class="why">That is not a “safe”. Don’t send until a check completes.</p></div><div class="r">${stopper("block")}</div></section>`;
  });
}

function addrSegs(s: string) {
  return s.length >= 40 ? `<span class="seg">${(s.match(/.{1,8}/g) ?? []).map(esc).join('</span> <span class="seg">')}</span>` : esc(s);
}
function diffHTML(a: string, b: string) {
  return [...a].map((ch, i) => (b[i] === ch ? esc(ch) : `<span class="x">${esc(ch)}</span>`)).join("");
}
function evidenceHTML(f: Finding) {
  if (!f.evidence?.length) return "";
  return `<div class="ev">${f.evidence.map((e) => e.url
    ? `<a href="${esc(e.url)}" target="_blank" rel="noopener"><b>${esc(e.label)} →</b> ${esc(e.value)} ↗</a>`
    : `<div><b>${esc(e.label)} →</b> ${esc(e.value)}</div>`).join("")}</div>`;
}

async function render(r: CheckResult) {
  const v = r.verdict === "BLOCKED" ? "block" : r.verdict === "SAFE" ? "safe" : "warn";
  const h = r.headline;
  const cnc = h?.status === "COULD_NOT_CHECK";
  const chip = { block: "BLOCKED", warn: cnc ? "COULDN’T CHECK" : "LOOK AGAIN", safe: "SAFE TO SEND" }[v];
  const tag = { block: "BOUNCED", warn: cnc ? "NOT VERIFIED" : "HELD FOR REVIEW", safe: "PASSED" }[v];
  const title = h ? h.title : r.account?.exists ? "Looks right. The account exists and nothing is wrong." : "Looks right. Every check that applies passed on live data.";
  const why = h ? h.detail : r.account?.exists ? `${r.account.summary} Every other check that applies passed on live data.` : "Gideon read the account, token and destination from public chain data and found nothing wrong.";
  const a = r.account;
  const acct = !a ? "" : `<p class="small acct"><b>Account:</b> ${a.exists === true ? `exists on NEAR ${esc(a.network)}${a.createdAt ? ` · created ${esc(a.createdAt.slice(0, 10))}` : ""} · ${esc(a.balanceNear ?? "?")} NEAR${a.contract ? " · runs a contract" : ""}` : a.exists === false ? `not found on NEAR ${esc(a.network)}` : "couldn’t check whether it exists"}</p>`;
  const fix = h?.fix ?? [];
  const asset = r.input.asset;
  const ex = await explain(r);
  const look = r.findings.find((f) => f.code === "LOOKALIKE_OF_CONTACT");
  const caseInfo = CASES.find((c) => c.id === q.get("example"));

  let addrBlock: string;
  if (look?.evidence?.length === 2) {
    const pasted = look.evidence[0].value, saved = look.evidence[1].value;
    addrBlock = `<div class="cmp"><span class="label">Saved</span><div class="addr ok">${esc(saved)}</div><span class="label">Pasted</span><div class="addr">${diffHTML(pasted, saved)}</div></div>`;
  } else {
    addrBlock = `<div class="addrbox"><div class="addr">${addrSegs(r.input.to)}</div></div>`;
  }
  const anno = `<div class="anno"><span>${esc(r.classification.label)}</span><span>${esc(r.input.network)}</span><span>${esc(r.input.amount ? r.input.amount + " " : "")}${esc(asset.symbol)}${asset.contract ? " · " + esc(asset.contract.length > 30 ? asset.contract.slice(0, 12) + "…" : asset.contract) : ""}</span><span>to: ${esc(r.input.destination)}${r.input.exchange ? " · " + esc(r.input.exchange) : ""}</span></div>`;

  const shown = r.findings.filter((f) => f.status !== "SKIPPED");
  const skippedN = r.findings.length - shown.length;
  const failed = r.sources.filter((s) => !s.ok && !s.optional);

  out.innerHTML = `
${caseInfo ? `<p class="notice" style="margin-top:28px">Example: ${esc(caseInfo.title)}. ${replay ? "Answered from recorded data (demo/fixtures.json)." : "Checked live just now."}</p>` : ""}
<section class="verdict ${v} crop"><div class="l"><span class="chip ${v}">${chip}</span>&nbsp; <span class="label">${h ? esc(h.code) : "ALL CLEAR"}</span>
 <h1 class="h1">${esc(title)}</h1>
 <div class="meta"><span>NEAR ${esc(r.input.network)}</span><span>${r.ms} ms</span><span>${r.sources.length} lookups${failed.length ? ` · ${failed.length} failed` : ""}</span><span>${esc(r.engine)}</span></div></div>
 <div class="r">${stopper(v === "safe" ? "safe" : "block")}<span class="tag">GIDEON · <b>${tag}</b></span></div></section>
<div class="grid"><div>
 <div class="card blk"><span class="sec-n">01 / WHAT YOU PASTED</span>${addrBlock}${anno}</div>
 <div class="card blk"><span class="sec-n">02 / ${v === "safe" ? "WHY IT’S FINE" : v === "block" ? "WHY IT’S STOPPED" : "WHY TO LOOK AGAIN"}</span><p class="why">${esc(why)}</p>${acct}${h ? evidenceHTML(h) : ""}
  ${ex.by !== "built-in" ? `<p class="small" style="margin-top:12px">Plain-words version (${esc(ex.by)}): ${esc(ex.text)}</p>` : ""}</div>
 ${fix.length ? `<div class="card blk"><span class="sec-n">03 / HOW TO FIX IT</span><ol class="fix">${fix.map((f) => `<li>${esc(f)}</li>`).join("")}</ol>
  <div class="actions"><a class="btn" href="index.html">Check another address <span class="wall"></span></a><button class="btn ghost" id="copyfix">Copy fix steps</button></div></div>`
  : `<div class="card blk"><div class="actions" style="margin-top:0">${v === "safe" ? `<a class="btn" style="background:var(--safe);border-color:var(--safe)" href="${esc(explorerAccountUrl(r.input.network, r.classification.normalized))}" target="_blank" rel="noopener">See the account on NearBlocks ↗</a>` : ""}<a class="btn ghost" href="index.html">Check another</a></div>
  ${v === "safe" ? `<p class="small" style="margin-top:12px">Gideon doesn’t send anything. Go back to your wallet and send there.</p>` : ""}</div>`}
</div><div>
 <div class="card blk"><div style="display:flex;justify-content:space-between"><span class="sec-n">CHECKS RUN</span><span class="label">${shown.length} ran · ${skippedN} not relevant</span></div>
  <table>${shown.map((f) => `<tr><td>${esc(RULE_NAMES[f.rule] ?? f.rule)}</td><td><span class="small">${esc(f.title)}</span></td><td><span class="st ${ST[f.status][0]}">${ST[f.status][1]}</span></td></tr>`).join("")}</table>
  <details class="more"><summary>Details for every rule</summary>${r.findings.map((f) => `<p class="small" style="margin-top:10px"><b class="mono">${esc(f.rule)} ${esc(f.code)}</b> · ${esc(f.detail)}</p>${evidenceHTML(f)}`).join("")}</details></div>
 <div class="card blk"><span class="sec-n">SOURCES ASKED</span>
  <table class="srcs">${r.sources.map((s) => `<tr><td>${esc(s.source.length > 48 ? s.source.slice(0, 34) + "…" + s.source.slice(-8) : s.source)}</td><td><span class="small">${s.ok ? `${s.ms} ms` : esc(s.error ?? "failed")}</span></td><td><span class="st ${s.ok ? "safe" : "cnc"}">${s.ok ? "OK" : s.optional ? "SKIPPED" : "FAILED"}</span></td></tr>`).join("") || `<tr><td colspan="3"><span class="small">None needed: the format alone decided it.</span></td></tr>`}</table>
  ${failed.length ? `<p class="small" style="margin-top:10px">A failed source never counts as safe. Those rules show “couldn’t check”.</p>` : ""}</div>
 <div class="card blk"><span class="sec-n">RECEIPT</span><div class="receipt">sha256 ${esc(r.receipt.sha256)}<br><span class="small mono">verdict=${esc(r.verdict)} · ${esc(r.checkedAt)} · ${r.receipt.signature ? "ed25519 signed" : "unsigned (signing needs a server key; the CLI can sign)"}</span></div>
  <div class="actions"><button class="btn sm ghost" id="copyjson">Copy result JSON</button></div></div>
 <div class="card blk" style="background:transparent;border-style:dashed"><span class="label">Try another real case</span><div class="actions" style="margin-top:10px">${CASES.map((c) => `<a class="btn sm ghost" href="check.html?example=${esc(c.id)}">${esc(c.id)}</a>`).join("")}</div></div>
</div></div>
${footer(`GIDEON · ${esc(r.engine)} · NEAR ${esc(r.input.network)}`)}`;

  document.getElementById("copyfix")?.addEventListener("click", (e) => {
    navigator.clipboard?.writeText(fix.map((x, i) => `${i + 1}. ${x}`).join("\n"));
    (e.target as HTMLElement).textContent = "Copied ✓";
  });
  document.getElementById("copyjson")?.addEventListener("click", (e) => {
    navigator.clipboard?.writeText(JSON.stringify(r, null, 2));
    (e.target as HTMLElement).textContent = "Copied ✓";
  });
  document.title = `Gideon · ${chip.toLowerCase()} · ${r.input.to.slice(0, 24)}`;
}
