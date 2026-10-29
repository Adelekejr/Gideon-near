import type { CheckResult } from "@gideon/core";
import { initChrome, stopper, esc, playVerdict, verdictState, STATIC } from "./chrome";
import { runCheck, CASES } from "./run";

initChrome("Agents");
const $ = (id: string) => document.getElementById(id)!;
const tl = $("tl"), tbs = $("tbs");
const BAD = CASES.find((c) => c.id === "tron-hash")!.input.to;
const GOOD = CASES.find((c) => c.id === "safe")!.input.to;
const cut = (s: string) => (s.length > 30 ? `${s.slice(0, 12)}…${s.slice(-6)}` : s);

function toolOut(r: CheckResult | Error) {
  if (r instanceof Error) return `<pre>{ error: <span class="vw">"${esc(r.message)}"</span> }  <span class="k">// treat as not checked</span></pre><div class="v" data-s="warn"></div>`;
  const cls = { block: "vb", warn: "vw", safe: "vs", idle: "vw" }[verdictState(r.verdict)];
  const h = r.headline;
  return `<pre>{ verdict: <span class="${cls}">"${r.verdict}"</span>${h ? `, code: <span class="${cls}">"${esc(h.code)}"</span>,\n  title: "${esc(h.title)}"` : `,\n  checks: ${r.findings.filter((f) => f.status !== "SKIPPED").length}, sources: ${r.sources.length}`},
  agent_action: <span class="${cls}">"${r.verdict === "SAFE" ? "SEND" : r.verdict === "ATTENTION" ? "ASK_HUMAN" : "DO_NOT_SEND"}"</span>, receipt: "${r.receipt.sha256.slice(0, 12)}…" }</pre><div class="v" data-s="${verdictState(r.verdict)}"></div>`;
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
  const WORD = { block: ["vb", "Bounced"], warn: ["vw", "Held"], safe: ["vs", "Passed"], idle: ["vw", ""] } as const;
  tl.querySelectorAll<HTMLElement>(".v").forEach((v) => {
    const st = v.dataset.s as keyof typeof WORD;
    v.innerHTML = stopper("idle") + `<span class="vl ${WORD[st][0]}">${WORD[st][1]}</span>`;
  });
  const lines = [...tl.children] as HTMLElement[];
  const still = STATIC;
  const verdictOf = (x: CheckResult | Error) => (x instanceof Error ? "warn" : verdictState(x.verdict));
  lines.forEach((l, i) => {
    const go = () => {
      l.classList.add("on");
      // The Arrow G plays the real result the moment Gideon's answer lands in the chat.
      const v = l.querySelector<HTMLElement>(".v");
      if (v) void playVerdict(v.querySelector(".gs"), v.dataset.s as "block" | "warn" | "safe");
      if (i === 3 || i === 7) { tbs.innerHTML = stopper("idle"); void playVerdict(tbs.querySelector(".gs"), verdictOf(i === 3 ? a : b)); }
    };
    still ? go() : tm.push(window.setTimeout(go, 300 + i * 900));
  });
}
$("replay").onclick = play;
play();
