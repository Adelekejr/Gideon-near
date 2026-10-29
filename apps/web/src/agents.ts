import type { CheckResult } from "@gideon/core";
import { initChrome, stopper, esc } from "./chrome";
import { runCheck, CASES } from "./run";

initChrome("Agents");
const $ = (id: string) => document.getElementById(id)!;
const tl = $("tl"), tbs = $("tbs");
const BAD = CASES.find((c) => c.id === "tron-hash")!.input.to;
const GOOD = CASES.find((c) => c.id === "safe")!.input.to;
const cut = (s: string) => (s.length > 30 ? `${s.slice(0, 12)}…${s.slice(-6)}` : s);

function toolOut(r: CheckResult | Error) {
  if (r instanceof Error) return `<pre>{ error: <span class="bad">"${esc(r.message)}"</span> }  <span class="k">// treat as not checked</span></pre>`;
  const cls = r.verdict === "SAFE" ? "good" : "bad";
  const h = r.headline;
  return `<pre>{ verdict: <span class="${cls}">"${r.verdict}"</span>${h ? `, code: <span class="${cls}">"${esc(h.code)}"</span>,\n  title: "${esc(h.title)}"` : `,\n  checks: ${r.findings.filter((f) => f.status !== "SKIPPED").length}, sources: ${r.sources.length}`},
  agent_action: <span class="${cls}">"${r.verdict === "SAFE" ? "SEND" : r.verdict === "ATTENTION" ? "ASK_HUMAN" : "DO_NOT_SEND"}"</span>, receipt: "${r.receipt.sha256.slice(0, 12)}…" }</pre><div class="v" data-s="${r.verdict === "SAFE" ? "safe" : "block"}"></div>`;
}

let tm: number[] = [];
async function play() {
  tm.forEach(clearTimeout); tm = [];
  tbs.innerHTML = stopper("idle");
  tl.innerHTML = `<div class="ln on"><span class="who">gideon</span><div>running live checks on NEAR testnet…</div></div>`;
  const opts = { network: "testnet" as const, asset: { symbol: "NEAR" }, amount: "25" };
  const [a, b] = await Promise.all([
    runCheck({ to: BAD, ...opts }).catch((e: Error) => e),
    runCheck({ to: GOOD, ...opts }).catch((e: Error) => e),
  ]);
  const blocked = !(a instanceof Error) && a.verdict !== "SAFE";
  const cleared = !(b instanceof Error) && b.verdict === "SAFE";
  const S: [string, string, string][] = [
    ["user", "User", `Pay Northwind’s invoice #4471: 25 NEAR to ${cut(BAD)}`],
    ["agent", "Agent", "Preparing a 25 NEAR transfer. Checking the recipient first."],
    ["tool", "→ tool", `<pre><span class="k">gideon_check</span>({ recipient: "${cut(BAD)}", token: "NEAR", amount: "25", network: "testnet" })</pre>`],
    ["tool", "← gideon", toolOut(a)],
    ["agent", "Agent", blocked ? "I didn’t send it. That string isn’t a NEAR account, so the money would be lost. Can you share Northwind’s NEAR deposit address?" : "Gideon couldn’t confirm this one, so I’m not sending. Can you double-check the address?"],
    ["user", "User", `Sorry, it’s ${GOOD}`],
    ["tool", "→ tool", `<pre><span class="k">gideon_check</span>({ recipient: "${GOOD}", token: "NEAR", amount: "25", network: "testnet" })</pre>`],
    [cleared ? "tool ok" : "tool", "← gideon", toolOut(b)],
    ["agent", "Agent", cleared ? `Cleared. Handing 25 NEAR to ${GOOD} to the wallet for signing, with the receipt attached.` : "Still not cleared. I’ll wait."],
  ];
  tl.innerHTML = S.map(([c, w, t]) => `<div class="ln ${c}"><span class="who">${w}</span><div>${t}</div></div>`).join("");
  tl.querySelectorAll<HTMLElement>(".v").forEach((v) => (v.innerHTML = stopper(v.dataset.s as "safe" | "block") + `<span style="color:${v.dataset.s === "safe" ? "#6FD39A" : "#FF8A63"};font-size:11px;letter-spacing:.1em">${v.dataset.s === "safe" ? "PASSED" : "BOUNCED"}</span>`));
  const lines = [...tl.children];
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches || location.hash === "#static";
  lines.forEach((l, i) => {
    const go = () => { l.classList.add("on"); if (i === 3) tbs.innerHTML = stopper("block"); if (i === 7) tbs.innerHTML = stopper(cleared ? "safe" : "block"); };
    still ? go() : tm.push(window.setTimeout(go, 300 + i * 1000));
  });
}
$("replay").onclick = play;
play();
