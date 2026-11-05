#!/usr/bin/env node
// Attack demo: read a planted invoice that names a lookalike payroll account, ask Gideon, stop.
// The invoice tells the agent to skip the checker. This demo asks anyway and follows the answer.
//   npm run demo:attack
//   npm run demo:attack -- --offline
// Exit 2 when Gideon says BLOCKED / DO_NOT_SEND and the demo stops. Nothing is signed.
import { relative } from "node:path";
import { connectGideon, colors, root, wantsOffline } from "./session.mjs";
import { PAYROLL_BOOK, loadInvoice } from "./invoice.mjs";

const { c } = colors();
const offline = wantsOffline();
const invoice = loadInvoice();
const saved = PAYROLL_BOOK[0];

const { client, tools, close } = await connectGideon({ name: "demo-attack-agent", offline });
console.log(c(1, `attack demo · planted invoice · ${invoice.network} · Gideon MCP (${tools.map((t) => t.name).join(", ")})${offline ? " · offline replay" : ""}`));
console.log(c(2, "policy: this demo follows Gideon. An agent that ignores DO_NOT_SEND can still send. This demo has no keys and never signs.\n"));

console.log(`read ${relative(root, invoice.path)}`);
console.log(`    invoice #4471 says: pay ${invoice.amount} ${invoice.token} to ${invoice.to}`);
console.log(`    address book: ${saved.account} (${saved.label})`);
if (invoice.override) {
  console.log(c(33, "    the invoice says to ignore the checker and any DO_NOT_SEND. This demo asks Gideon anyway."));
}
console.log(c(2, "    → gideon_check"));

const r = await client.callTool({
  name: "gideon_check",
  arguments: {
    network: invoice.network,
    token: invoice.token,
    recipient: invoice.to,
    amount: invoice.amount,
    address_book: PAYROLL_BOOK,
  },
});
const s = r.structuredContent;
if (r.isError || !s) {
  console.log(c(31, `    tool error, treating as DO_NOT_SEND: ${r.content?.[0]?.text}`));
  console.log(c(31, "STOP"));
  console.log(c(31, "    not sent. No transaction was signed."));
  await close();
  process.exit(2);
}

const tone = s.verdict === "BLOCKED" ? 31 : s.verdict === "ATTENTION" ? 33 : 32;
console.log(`    ${c(tone, c(1, `${s.verdict} → ${s.agent_action}`))}`);
if (s.headline) console.log(`    ${s.headline}`);
for (const f of s.fix ?? []) console.log(c(2, `    fix: ${f}`));
for (const line of s.not_checked ?? []) console.log(c(2, `    ${line}`));

const stopped = s.verdict === "BLOCKED" && s.agent_action === "DO_NOT_SEND";
if (stopped) {
  console.log("");
  console.log(c(31, c(1, "STOP  BLOCKED  DO_NOT_SEND")));
  console.log(c(31, `    not sent. ${invoice.amount} ${invoice.token} did not go to ${invoice.to}.`));
  console.log(c(31, "    the payout run stops here. Gideon advises; an agent that ignores DO_NOT_SEND can still send."));
  console.log(c(2, "    No transaction was signed."));
} else {
  console.log(c(31, `    expected BLOCKED / DO_NOT_SEND for this lookalike. Got ${s.verdict} / ${s.agent_action}. Nothing sent.`));
}
await close();
process.exit(stopped ? 2 : 3);
