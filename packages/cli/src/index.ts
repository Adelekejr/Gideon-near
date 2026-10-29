#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { check, explain, newReceiptKey, resolveNetwork, verifyReceipt, type CheckInput, type CheckResult, type Contact, type Destination } from "@gideon/core";
import { liveSources, nearAiExplainer, sourcesOptionsFromEnv } from "@gideon/sources";

const HELP = `gideon — check a NEAR send before you make it

  gideon check <to> [options]
    --network testnet|mainnet   default: testnet (or GIDEON_NETWORK)
    --asset NEAR|wNEAR|USDC|…   symbol (default NEAR)
    --contract <token.near>     NEP-141 contract for a token send
    --amount <n>                human amount, e.g. 25
    --dest wallet|exchange|intents|unknown
    --exchange <id>             generic, binance, coinbase, kraken, okx
    --from <account>            your account (for lookalike history)
    --book <file.json>          address book: [{"account":"x.testnet","label":"Ada"}]
    --copied <text>             what you copied (clipboard check)
    --registry <contract>       community flag registry for R10 (or GIDEON_FLAG_REGISTRY)
    --json                      print the full result JSON
  gideon keygen                 new receipt signing key (set GIDEON_RECEIPT_KEY)
  gideon verify-receipt <result.json>

Exit code: 0 SAFE, 1 ATTENTION, 2 BLOCKED, 64 usage error.`;

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
  if (cmd !== "check") { console.error(HELP); return 64; }

  const { values, positionals } = parseArgs({
    args: rest, allowPositionals: true,
    options: {
      network: { type: "string" }, asset: { type: "string" }, contract: { type: "string" }, amount: { type: "string" },
      dest: { type: "string" }, exchange: { type: "string" }, from: { type: "string" }, book: { type: "string" },
      copied: { type: "string" }, registry: { type: "string" }, json: { type: "boolean" },
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
  const r = await check(input, liveSources(sourcesOptionsFromEnv(process.env)), {
    receiptKey: process.env.GIDEON_RECEIPT_KEY || undefined,
    ...(flagRegistry !== undefined ? { flagRegistry } : {}),
  });
  if (values.json) console.log(JSON.stringify(r, null, 2));
  else await print(r);
  return r.verdict === "SAFE" ? 0 : r.verdict === "ATTENTION" ? 1 : 2;
}

async function print(r: CheckResult) {
  const col = r.verdict === "BLOCKED" ? C.r : r.verdict === "ATTENTION" ? C.y : C.g;
  console.log(`\n${C.b}${col}${r.verdict}${C.x}  ${r.input.to}  ${C.d}(${r.classification.label}, ${r.input.network})${C.x}`);
  if (r.headline) console.log(`${C.b}${r.headline.title}${C.x}\n${r.headline.detail}`);
  const ex = process.env.NEARAI_API_KEY ? nearAiExplainer({ apiKey: process.env.NEARAI_API_KEY, model: process.env.NEARAI_MODEL || undefined }) : null;
  if (ex) { const e = await explain(r, ex); console.log(`${C.d}(${e.by})${C.x} ${e.text}`); }
  for (const [i, s] of (r.headline?.fix ?? []).entries()) console.log(`  ${i + 1}. ${s}`);
  console.log("");
  for (const x of r.findings) console.log(` ${ICON[x.status]}${C.x} ${x.rule.padEnd(3)} ${x.title}${x.status === "SKIPPED" ? "" : `${C.d} — ${x.detail}${C.x}`}`);
  console.log(`\n${C.d}sources: ${r.sources.map((s) => `${s.source.split(":")[0]} ${s.ok ? "ok" : "FAILED"} ${s.ms}ms`).join(", ") || "none"}`);
  console.log(`receipt sha256 ${r.receipt.sha256}${r.receipt.signature ? " (signed)" : ""}${C.x}`);
}

main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(64); });
