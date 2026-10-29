#!/usr/bin/env node
// Re-record the offline fixtures from the live, free APIs (read-only).
// Usage: npm run record
import { readFileSync, writeFileSync } from "node:fs";
import { check } from "@gideon/core";
import { liveSources, recordingSources } from "@gideon/sources";

const cases = JSON.parse(readFileSync(new URL("../demo/cases.json", import.meta.url), "utf8")).cases;
const rec = {};
// Don't keep third-party account names from 1Click quotes in the repo.
const scrub = (method, v) => {
  if (method !== "oneClickStatus" || !v) return v;
  const c = structuredClone(v);
  const q = c.quoteResponse?.quoteRequest;
  if (q) { delete q.recipient; delete q.refundTo; delete q.appFees; delete q.referral; }
  delete c.swapDetails;
  return c;
};
const sources = recordingSources(liveSources(), rec, scrub);
for (const c of cases) {
  const r = await check(c.input, sources);
  const ok = r.verdict === c.expect.verdict && (r.headline?.code ?? null) === c.expect.headline;
  console.log(`${ok ? "ok  " : "DIFF"} ${c.id.padEnd(22)} ${r.verdict.padEnd(9)} ${r.headline?.code ?? "-"}`);
}
const out = { recordedAt: new Date().toISOString(), note: "Live answers recorded by scripts/record-fixtures.mjs. Read-only calls only.", answers: rec };
writeFileSync(new URL("../demo/fixtures.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(`saved ${Object.keys(rec).length} answers to demo/fixtures.json`);
