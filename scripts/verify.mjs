#!/usr/bin/env node
// One command that proves Gideon works.
//   npm run verify            build + offline tests + demo cases from recorded answers (no network)
//   npm run verify -- --live  also run the demo cases against the live, free APIs
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const live = process.argv.includes("--live");
const step = (name, cmd) => {
  process.stdout.write(`\n▶ ${name}\n`);
  execSync(cmd, { stdio: "inherit" });
};

step("build (TypeScript)", "npm run build --silent");
step("unit tests (offline)", "npx vitest run");

const { check } = await import("@gideon/core");
const { liveSources, replaySources } = await import("@gideon/sources");
const { cases } = JSON.parse(readFileSync(new URL("../demo/cases.json", import.meta.url), "utf8"));
const { answers, recordedAt } = JSON.parse(readFileSync(new URL("../demo/fixtures.json", import.meta.url), "utf8"));

async function runCases(label, sources) {
  process.stdout.write(`\n▶ demo cases — ${label}\n`);
  let bad = 0;
  for (const c of cases) {
    const r = await check(c.input, sources);
    const ok = r.verdict === c.expect.verdict && (r.headline?.code ?? null) === c.expect.headline;
    if (!ok) bad++;
    console.log(`  ${ok ? "✓" : "✗"} ${c.id.padEnd(22)} ${r.verdict.padEnd(9)} ${(r.headline?.code ?? "-").padEnd(26)} ${ok ? "" : `expected ${c.expect.verdict} ${c.expect.headline}`}`);
  }
  return bad;
}

let failures = await runCases(`recorded answers from ${recordedAt.slice(0, 10)} (offline)`, replaySources(answers));
if (live) failures += await runCases("live APIs", liveSources());

console.log(failures ? `\n✗ verify failed: ${failures} demo case(s) off` : "\n✓ verify passed");
process.exit(failures ? 1 : 0);
