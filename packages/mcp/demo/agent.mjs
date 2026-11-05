#!/usr/bin/env node
// A scripted "payments agent" (no LLM, no keys) that runs a payout queue and asks
// Gideon over MCP before every send. It never signs: "sent" here means "would send".
//   node packages/mcp/demo/agent.mjs            live, free public APIs (testnet)
//   node packages/mcp/demo/agent.mjs --offline  recorded answers from demo/fixtures.json
import { colors, connectGideon, wantsOffline } from "./session.mjs";

const offline = wantsOffline();
const { c } = colors();
const color = { SAFE: 32, ATTENTION: 33, BLOCKED: 31 };

const contacts = [{ account: "northwind-payroll.testnet", label: "Northwind payroll" }];
const queue = [
  { memo: "Rent for October", recipient: "hammed-stampdue.testnet", amount: "1", destination: "wallet" },
  { memo: "Refund, customer pasted an Ethereum address", recipient: "0x94a0abA1283aF69Cb260b7e0Ea0366Dca0dd3cd8", amount: "5" },
  { memo: "Payroll run (from an emailed invoice)", recipient: "northwind-payro11.testnet", amount: "40", address_book: contacts },
  { memo: "Vendor invoice", recipient: "alice.near", amount: "1" },
];

const { client, tools, close } = await connectGideon({ name: "demo-payments-agent", offline });

console.log(c(1, `payments agent · ${queue.length} payouts on testnet · Gideon MCP (${tools.map((t) => t.name).join(", ")})${offline ? " · offline replay" : ""}`));
console.log(c(2, "policy: this demo follows Gideon. It can't stop an agent that ignores the advice. SAFE is not proof of ownership.\n"));

let sent = 0, held = 0, halted = false;
for (const [i, p] of queue.entries()) {
  const n = `${i + 1}/${queue.length}`;
  if (halted) { console.log(c(2, `${n} ${p.memo}: not attempted (run stopped)`)); continue; }
  console.log(`${n} ${p.memo}: ${p.amount} NEAR → ${p.recipient}`);
  console.log(c(2, `    → gideon_check`));
  const r = await client.callTool({ name: "gideon_check", arguments: { network: "testnet", token: "NEAR", ...p, memo: undefined } });
  const s = r.structuredContent;
  if (r.isError || !s) { console.log(c(31, `    tool error, treating as DO_NOT_SEND: ${r.content?.[0]?.text}`)); halted = true; continue; }
  console.log(`    ${c(color[s.verdict], c(1, s.verdict))} ${c(2, `(${s.agent_action})`)}${s.headline ? ` ${s.headline}` : ""}`);
  if (s.verdict === "SAFE" && s.agent_action === "SEND") { sent++; console.log(c(32, `    ✓ would send ${p.amount} NEAR (simulated, this demo has no keys)`)); }
  else if (s.verdict === "SAFE") { held++; console.log(c(33, `    ⏸ SAFE is not proof of ownership, and agent_action is ${s.agent_action} (pass from so first-send runs). Nothing sent.`)); }
  else if (s.verdict === "ATTENTION") { held++; console.log(c(33, `    ⏸ held: asking a human before sending. Nothing sent.`)); }
  else {
    halted = true;
    s.fix.forEach((f) => console.log(c(2, `    fix: ${f}`)));
    console.log(c(31, `    ✗ not sent. Stopping the payout run for human review.`));
  }
  console.log("");
}
console.log(c(1, `done: ${sent} sent (simulated), ${held} waiting for a human, ${halted ? "run stopped on BLOCKED" : "no blocks"}. No transaction was signed.`));
await close();
process.exit(halted ? 2 : held ? 1 : 0);
