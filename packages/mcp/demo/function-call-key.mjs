#!/usr/bin/env node
// Function-call key demo: the agent holds one app key for one contract and one method.
// There is no secret in this file. The key is a permission. Payments still go through Gideon.
//   npm run demo:function-call-key
//   npm run demo:function-call-key -- --offline
// Exit 2 when the planted lookalike is BLOCKED / DO_NOT_SEND and the demo does not call the contract.
import { connectGideon, colors, wantsOffline } from "./session.mjs";
import { PAYROLL_BOOK, loadInvoice } from "./invoice.mjs";

const { c } = colors();
const offline = wantsOffline();
const invoice = loadInvoice();

/**
 * A NEAR function-call (app) key. Not full access.
 * allowanceNear is gas the key may burn, not a cap on the token amount ft_transfer moves.
 * No private key is stored or used.
 */
const APP_KEY = {
  accountId: "hammed-stampdue.testnet",
  permission: "FunctionCall",
  receiverId: "wrap.testnet",
  methodNames: ["ft_transfer"],
  allowanceNear: "0.25",
};

/** Whether this key could sign the action. Local only: it does not ask the chain. */
function keyAllows(action) {
  if (action.type !== "FunctionCall") {
    return { allowed: false, why: `a function-call key cannot sign ${action.type}` };
  }
  if (action.receiverId !== APP_KEY.receiverId) {
    return { allowed: false, why: `this key can only call ${APP_KEY.receiverId}, not ${action.receiverId}` };
  }
  if (!APP_KEY.methodNames.includes(action.methodName)) {
    return { allowed: false, why: `this key can only call ${APP_KEY.methodNames.join(", ")}, not ${action.methodName}` };
  }
  return { allowed: true, why: `FunctionCall ${action.methodName}() on ${action.receiverId} is inside this key` };
}

const queue = [
  {
    label: "direct NEAR transfer (a full-access action)",
    action: { type: "Transfer", receiverId: "northwind-payroll.testnet" },
    pay: null,
  },
  {
    label: "add a full-access key on the same account",
    action: { type: "AddKey", receiverId: APP_KEY.accountId },
    pay: null,
  },
  {
    label: `planted invoice: ft_transfer to ${invoice.to}`,
    action: { type: "FunctionCall", receiverId: APP_KEY.receiverId, methodName: "ft_transfer" },
    note: "the invoice asks for native NEAR. This key cannot sign Transfer, so the only pay path is ft_transfer of wNEAR. Gideon still checks the receiver.",
    pay: { recipient: invoice.to, amount: invoice.amount, token: "wNEAR", token_contract: APP_KEY.receiverId },
  },
  {
    label: "ft_transfer of wNEAR back to the key's own account",
    action: { type: "FunctionCall", receiverId: APP_KEY.receiverId, methodName: "ft_transfer" },
    pay: { recipient: APP_KEY.accountId, amount: "1", token: "wNEAR", token_contract: APP_KEY.receiverId },
  },
];

const { client, tools, close } = await connectGideon({ name: "demo-function-call-agent", offline });
console.log(c(1, `function-call key demo · ${APP_KEY.accountId} · Gideon MCP (${tools.map((t) => t.name).join(", ")})${offline ? " · offline replay" : ""}`));
console.log(c(2, "policy: this demo follows Gideon. An agent that ignores DO_NOT_SEND can still send when the key allows the call. This demo holds no secret and never signs.\n"));

console.log("key (permission only, no secret)");
console.log(`    account:     ${APP_KEY.accountId}`);
console.log(`    permission:  ${APP_KEY.permission}`);
console.log(`    receiver_id: ${APP_KEY.receiverId}   (only this contract)`);
console.log(`    methods:     ${APP_KEY.methodNames.join(", ")}   (only this method)`);
console.log(`    allowance:   ${APP_KEY.allowanceNear} NEAR of gas   (not a limit on how much the method can move)`);
console.log(c(2, "    cannot sign Transfer, AddKey, DeleteKey, DeleteAccount, DeployContract, Stake,"));
console.log(c(2, "    any other contract, or any method other than ft_transfer."));
console.log(c(2, "    can still call ft_transfer on wrap.testnet with any receiver_id in the arguments."));
console.log(c(2, "    The key does not check that receiver. Gideon does.\n"));

let refused = 0;
let stopped = false;
let held = 0;
for (const [i, step] of queue.entries()) {
  const n = `${i + 1}/${queue.length}`;
  console.log(`${n} ${step.label}`);
  const gate = keyAllows(step.action);
  if (!gate.allowed) {
    refused++;
    console.log(c(33, `    KEY REFUSED: ${gate.why}.`));
    console.log(c(2, "    Gideon was not asked. Nothing signed.\n"));
    continue;
  }
  console.log(c(2, `    key allows this call shape (${gate.why}).`));
  if (step.note) console.log(c(2, `    ${step.note}`));
  console.log(c(2, `    → gideon_check  recipient ${step.pay.recipient}`));
  const r = await client.callTool({
    name: "gideon_check",
    arguments: {
      network: "testnet",
      recipient: step.pay.recipient,
      amount: step.pay.amount,
      token: step.pay.token,
      token_contract: step.pay.token_contract,
      address_book: PAYROLL_BOOK,
    },
  });
  const s = r.structuredContent;
  if (r.isError || !s) {
    stopped = true;
    console.log(c(31, `    tool error, treating as DO_NOT_SEND: ${r.content?.[0]?.text}`));
    console.log(c(31, "STOP  BLOCKED  DO_NOT_SEND"));
    console.log(c(2, "    not calling ft_transfer. No transaction was signed.\n"));
    continue;
  }
  const tone = s.verdict === "BLOCKED" ? 31 : s.verdict === "ATTENTION" ? 33 : 32;
  console.log(`    ${c(tone, c(1, `${s.verdict} → ${s.agent_action}`))}`);
  if (s.headline) console.log(`    ${s.headline}`);
  for (const line of s.not_checked ?? []) console.log(c(2, `    ${line}`));
  if (s.verdict === "BLOCKED" && s.agent_action === "DO_NOT_SEND") {
    stopped = true;
    console.log("");
    console.log(c(31, c(1, "STOP  BLOCKED  DO_NOT_SEND")));
    console.log(c(31, `    not calling ft_transfer. ${step.pay.amount} ${step.pay.token} did not go to ${step.pay.recipient}.`));
    console.log(c(31, "    the key would still allow this call. This demo follows DO_NOT_SEND."));
    console.log(c(31, "    An agent that ignores DO_NOT_SEND, and holds a real key like this, can still send."));
  } else if (s.verdict === "SAFE" && s.agent_action === "SEND") {
    console.log(c(32, "    Gideon said SEND. This demo still does not sign: it has no secret."));
  } else {
    held++;
    console.log(c(33, `    held (${s.agent_action}). Not calling ft_transfer. Nothing signed.`));
  }
  console.log("");
}

console.log(c(1, `done: 0 calls signed, ${refused} refused by the key, ${held} waiting on Gideon, ${stopped ? "planted payment stopped on DO_NOT_SEND" : "planted invoice was not blocked"}.`));
console.log(c(2, "No transaction was signed."));
await close();
process.exit(stopped ? 2 : 3);
