#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { accountHealth, check, checkDrainer, HEALTH_TEXT, healthNetwork, checkTransaction, explain, newReceiptKey, resolveNetwork, verifyReceipt, type CheckInput, type CheckResult, type Contact, type Destination, type TxCheckResult, type AccountHealthResult } from "@gideon/core";
import { liveSources, nearAiExplainer, sourcesOptionsFromEnv } from "@gideon/sources";
import { withDrainer } from "@gideon/core";
import { notCheckedText, sendLabel, sendSafeText, txLabel, txNotCheckedText, txSafeText } from "./words.js";

const HELP = `gideon — check a NEAR send before you make it

  gideon check <to> [options]
    --network testnet|mainnet   default: testnet (or GIDEON_NETWORK)
    --asset NEAR|wNEAR|USDC|…   symbol (default NEAR)
    --contract <token.near>     NEP-141 contract for a token send
    --amount <n>                human amount, e.g. 25
    --dest wallet|exchange|intents|unknown
    --exchange <id>             generic, binance, coinbase, kraken, okx
    --from <account>            your account: first-send note, lookalikes, and whether
                                this amount is much larger than you usually send
    --book <file.json>          address book: [{"account":"x.testnet","label":"Ada"}]
    --copied <text>             what you copied (clipboard check)
    --registry <contract>       community flag registry for R10 (or GIDEON_FLAG_REGISTRY)
    --json                      print the full result JSON
    --no-drainer                skip the drained-wallet check (R18: recent senders that look
                                hacked); otherwise it runs after the main check, up to 8 s
  gideon check-tx <link|base64|json|-> [options]
                                check a transaction or sign-in BEFORE you approve it in your
                                wallet: a MyNearWallet or Meteor sign/login link, base64
                                transaction(s), or wallet-selector JSON ("-" reads stdin).
                                Also flags a swap/bridge minimum far below the amount in,
                                and a send much larger than the signer's recent history
    --network testnet|mainnet   when the request doesn't say
    --signer <account>          the account that would sign, if the request doesn't name it
    --mine <a,b>                your own accounts (never "unseen")
    --book <file.json>          address book, as above
    --json                      print the full result JSON
  gideon keys <account> [options]
                                account health: list the account's keys and flag ones that
                                could let someone else act for it (read-only, signs nothing)
    --network testnet|mainnet   default: from the name (.near = mainnet), else testnet
    --links                     ready-to-sign remove requests (unsigned) for every removable key;
                                flagged and tidy-up keys always get one
    --json                      print the full result JSON
  gideon keygen                 new receipt signing key (set GIDEON_RECEIPT_KEY)
  gideon verify-receipt <result.json>

Exit code: 0 SAFE, 1 ATTENTION, 2 BLOCKED, 64 usage error.
keys: 0 no red flag, 2 a red flag, 1 couldn't check or no such account, 64 usage error.`;

const C = process.stdout.isTTY ? { r: "\x1b[31m", y: "\x1b[33m", g: "\x1b[32m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" } : { r: "", y: "", g: "", d: "", b: "", x: "" };
const ICON: Record<string, string> = { BLOCKED: `${C.r}✖`, ATTENTION: `${C.y}!`, PASS: `${C.g}✓`, COULD_NOT_CHECK: `${C.y}?`, SKIPPED: `${C.d}·` };

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "-h" || cmd === "--help") { console.log(HELP); return 0; }
  if (cmd === "keygen") { console.log(newReceiptKey()); return 0; }
  if (cmd === "verify-receipt") {
    if (!rest[0]) { console.error(HELP); return 64; }
    const r = JSON.parse(readFileSync(rest[0], "utf8")) as CheckResult;
    const v = await verifyReceipt(r);
    console.log(`hash ${v.hashOk ? "OK" : "MISMATCH"}; signature ${v.signatureOk === null ? "not signed" : v.signatureOk ? "OK" : "INVALID"}`);
    return v.hashOk && v.signatureOk !== false ? 0 : 2;
  }
  if (cmd === "check-tx") return checkTx(rest);
  if (cmd === "keys") return keys(rest);
  if (cmd !== "check") { console.error(HELP); return 64; }

  const { values, positionals } = parseArgs({
    args: rest, allowPositionals: true,
    options: {
      network: { type: "string" }, asset: { type: "string" }, contract: { type: "string" }, amount: { type: "string" },
      dest: { type: "string" }, exchange: { type: "string" }, from: { type: "string" }, book: { type: "string" },
      copied: { type: "string" }, registry: { type: "string" }, json: { type: "boolean" },
      "no-drainer": { type: "boolean" },
    },
  });
  const to = positionals[0];
  if (to === undefined) { console.error(HELP); return 64; }
  const input: CheckInput = {
    to,
    network: resolveNetwork(values.network ?? process.env.GIDEON_NETWORK),
    asset: { symbol: values.asset ?? "NEAR", ...(values.contract ? { contract: values.contract } : {}) },
    amount: values.amount,
    destination: (values.dest as Destination) ?? "unknown",
    exchange: values.exchange,
    from: values.from,
    addressBook: values.book ? (JSON.parse(readFileSync(values.book, "utf8")) as Contact[]) : undefined,
    clipboard: values.copied ? { copied: values.copied } : undefined,
  };
  const flagRegistry = values.registry ?? process.env.GIDEON_FLAG_REGISTRY;
  const sources = liveSources(sourcesOptionsFromEnv(process.env));
  const receiptKey = process.env.GIDEON_RECEIPT_KEY || undefined;
  const first = await check(input, sources, {
    receiptKey,
    historyTimeoutMs: 4000,
    ...(flagRegistry !== undefined ? { flagRegistry } : {}),
  });
  // The drained-wallet check (R18) on the recipient's recent senders: time-limited. If it fails,
  // the result says so ("Not checked") instead of staying quiet.
  const r = values["no-drainer"] ? first : await checkDrainer(first, sources, {}, { timeoutMs: 8000 }, receiptKey)
    .catch(() => withDrainer(first, { rule: "R18", status: "SKIPPED", code: "FAILED", title: "Drained-wallet check didn't run", detail: "The check failed." }, receiptKey));
  if (values.json) console.log(JSON.stringify(r, null, 2));
  else await print(r);
  return r.verdict === "SAFE" ? 0 : r.verdict === "ATTENTION" ? 1 : 2;
}

async function checkTx(rest: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: rest, allowPositionals: true,
    options: { network: { type: "string" }, signer: { type: "string" }, mine: { type: "string" }, book: { type: "string" }, json: { type: "boolean" } },
  });
  const arg = positionals[0];
  if (arg === undefined) { console.error(HELP); return 64; }
  const request = arg === "-" ? readFileSync(0, "utf8") : arg;
  const net = values.network ?? process.env.GIDEON_NETWORK;
  const r = await checkTransaction({
    request,
    ...(net ? { network: resolveNetwork(net) } : {}),
    ...(values.signer ? { signerId: values.signer } : {}),
    ...(values.mine ? { myAccounts: values.mine.split(",").map((x) => x.trim()).filter(Boolean) } : {}),
    ...(values.book ? { addressBook: JSON.parse(readFileSync(values.book, "utf8")) as Contact[] } : {}),
  }, liveSources(sourcesOptionsFromEnv(process.env)));
  if (values.json) console.log(JSON.stringify(r, null, 2));
  else printTx(r);
  return r.verdict === "SAFE" ? 0 : r.verdict === "ATTENTION" ? 1 : 2;
}

async function keys(rest: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: rest, allowPositionals: true,
    options: { network: { type: "string" }, json: { type: "boolean" }, links: { type: "boolean" } },
  });
  const account = positionals[0];
  if (account === undefined) { console.error(HELP); return 64; }
  const net = values.network ?? process.env.GIDEON_NETWORK;
  let r: AccountHealthResult;
  try {
    r = await accountHealth({ account, network: net ? resolveNetwork(net) : healthNetwork(account) }, liveSources(sourcesOptionsFromEnv(process.env)));
  } catch (e) { console.error(e instanceof Error ? e.message : e); return 64; }
  if (values.json) console.log(JSON.stringify(r, null, 2));
  else printKeys(r, !!values.links);
  return r.status === "not-found" || r.status === "could-not-check" ? 1 : r.red ? 2 : 0;
}

function printKeys(r: AccountHealthResult, links: boolean) {
  const col = r.red ? C.r : r.status === "attention" ? C.y : r.status === "clean" ? C.g : C.y;
  console.log(`\n${C.b}${HEALTH_TEXT.heading}${C.x}  ${C.d}(${r.account}, ${r.network})${C.x}`);
  console.log(`${C.b}${col}${r.summary}${C.x}`);
  if (r.advice) console.log(`${C.r}${r.advice}${C.x}`);
  console.log("");
  const tidy = r.keys.filter((k) => k.tidy).length;
  for (const k of r.keys) {
    if (k.tidy && k === r.keys.find((x) => x.tidy)) console.log(` ${C.b}${HEALTH_TEXT.tidyHeading}${C.x} ${C.d}· ${tidy} · ${HEALTH_TEXT.tidyNote}${C.x}`);
    const when = k.addedAt ? `Added ${new Date(k.addedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}` : HEALTH_TEXT.addedUnknown;
    const what = k.kind === "full" ? "Full control key" : `App key: ${k.contract}`;
    const icon = k.flags.some((f) => f.level === "red") ? `${C.r}✖` : k.tidy ? `${C.d}·` : k.flags.length ? `${C.y}!` : `${C.g}✓`;
    console.log(` ${icon}${C.x} ${k.publicKey}`);
    console.log(`     ${what} ${C.d}· ${when}${k.uses != null ? ` · used ${k.uses}×` : ""}${C.x}`);
    if (k.probableWalletKey) console.log(`     ${C.y}${HEALTH_TEXT.walletKey}${C.x}`);
    for (const f of k.flags) {
      console.log(`     ${f.level === "red" ? C.r : f.level === "tidy" ? C.d : C.y}${f.text}${C.x}`);
      if (f.why) console.log(`       ${C.d}${f.why}${C.x}`);
    }
    // Ready-to-sign removal (unsigned): for flagged and tidy-up keys, or every removable key with --links.
    const p = k.remove;
    if (p && (links || (k.flags.length && !k.probableWalletKey))) {
      console.log(`     ${C.d}${HEALTH_TEXT.removeButton} (unsigned; you sign in your wallet): ${p.confirm}${C.x}`);
      if (p.walletKeyWarning) console.log(`       ${C.y}${HEALTH_TEXT.walletKey}${C.x}`);
      console.log(`       Meteor: ${p.links.meteor}`);
      if (p.links.mynearwallet) console.log(`       MyNearWallet: ${p.links.mynearwallet}`);
      console.log(`       near-cli-rs: ${p.nearCli}`);
      console.log(`       near-mcp: ${p.nearMcp.tool} ${JSON.stringify(p.nearMcp.args)}`);
      console.log(`       transaction (base64): ${p.transaction}`);
    }
  }
  for (const n of r.notes) console.log(` ${C.d}· ${n}${C.x}`);
  console.log(`\n${C.d}${HEALTH_TEXT.footer}${C.x}`);
}

function printTx(r: TxCheckResult) {
  const col = r.verdict === "BLOCKED" ? C.r : r.verdict === "ATTENTION" ? C.y : C.g;
  console.log(`\n${C.b}${col}${txLabel(r.verdict)}${C.x}  ${C.d}(${r.network}${r.signer ? `, signer ${r.signer}` : ""}${r.origin ? `, from ${r.origin}` : ""})${C.x}`);
  if (r.headline) console.log(`${C.b}${r.headline.title}${C.x}${r.headline.detail ? `\n${r.headline.detail}` : ""}`);
  for (const p of r.preview ?? []) console.log(p);
  for (const n of r.findings.filter((f) => f.code === "KNOWN_EXCHANGE")) console.log(`${n.title}. ${n.detail}`);
  const [st, sb] = txSafeText(r);
  if (st) console.log(`${C.b}${st}${C.x}\n${sb}`);
  for (const [i, s] of (r.headline?.fix ?? []).entries()) console.log(`  ${i + 1}. ${s}`);
  for (const n of txNotCheckedText(r)) console.log(`${C.y}${n}${C.x}`);
  console.log("");
  for (const t of r.transactions) {
    const acts = t.actions.map((a) => a.type === "FunctionCall" ? `${a.methodName}()` : a.type === "AddKey" ? `AddKey(${a.fullAccess ? "FULL ACCESS" : "function-call"})` : a.type);
    console.log(` ${C.d}→${C.x} ${t.receiverId}: ${acts.join(", ") || "no actions"}${t.partial ? ` ${C.y}(not fully readable)${C.x}` : ""}`);
  }
  if (r.signIn) console.log(` ${C.d}→${C.x} sign-in asking for a full-access key${r.signIn.site ? ` (${r.signIn.site})` : ""}`);
  for (const x of r.findings) {
    console.log(` ${ICON[x.status]}${C.x} ${x.rule.padEnd(3)} ${x.title}${x.detail ? `${C.d} — ${x.detail}${C.x}` : ""}`);
    for (const e of x.evidence ?? []) console.log(`       ${C.d}${e.label}: ${e.value}${C.x}`);
  }
}

async function print(r: CheckResult) {
  const col = r.verdict === "BLOCKED" ? C.r : r.verdict === "ATTENTION" ? C.y : C.g;
  console.log(`\n${C.b}${col}${sendLabel(r.verdict)}${C.x}  ${r.input.to}  ${C.d}(${r.classification.label}, ${r.input.network})${C.x}`);
  if (r.headline) console.log(`${C.b}${r.headline.title}${C.x}\n${r.headline.detail}`);
  const [st, sb] = sendSafeText(r);
  if (st) console.log(`${C.b}${st}${C.x}\n${sb}`);
  for (const l of notCheckedText(r)) console.log(`${C.y}${l}${C.x}`);
  for (const e of r.headline?.evidence ?? []) if (e.url) console.log(`${e.label}: ${e.url}`);
  const ex = process.env.NEARAI_API_KEY ? nearAiExplainer({ apiKey: process.env.NEARAI_API_KEY, model: process.env.NEARAI_MODEL || undefined }) : null;
  if (ex) { const e = await explain(r, ex); console.log(`${C.d}(${e.by})${C.x} ${e.text}`); }
  for (const [i, s] of (r.headline?.fix ?? []).entries()) console.log(`  ${i + 1}. ${s}`);
  console.log("");
  for (const x of r.findings) console.log(` ${ICON[x.status]}${C.x} ${x.rule.padEnd(3)} ${x.title}${x.status === "SKIPPED" ? "" : `${C.d} — ${x.detail}${C.x}`}`);
  console.log(`\n${C.d}sources: ${r.sources.map((s) => `${s.source.split(":")[0]} ${s.ok ? "ok" : "FAILED"} ${s.ms}ms`).join(", ") || "none"}`);
  console.log(`receipt sha256 ${r.receipt.sha256}${r.receipt.signature ? " (signed)" : ""}${C.x}`);
}

main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(64); });
