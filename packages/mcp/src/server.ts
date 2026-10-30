import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { readFileSync } from "node:fs";
import {
  check, explain, NETWORKS, resolveNetwork, verifyReceipt,
  type CheckInput, type CheckResult, type Explainer, type Network, type Sources, type Verdict,
} from "@gideon/core";
import { liveSources, nearAiExplainer, replaySources, sourcesOptionsFromEnv } from "@gideon/sources";

export const VERSION = "0.1.0";

/** What an agent must do with each verdict. This is the contract of the server. */
export const AGENT_ACTION = { SAFE: "SEND", ATTENTION: "ASK_HUMAN", BLOCKED: "DO_NOT_SEND" } as const satisfies Record<Verdict, string>;
const INSTRUCTION: Record<Verdict, string> = {
  SAFE: "SAFE: every check that applies passed on live data. You may send exactly this recipient, amount, token and network.",
  ATTENTION: "ATTENTION: do not send on your own. Stop and ask a human, showing them the reasons below. \"Couldn't check\" is ATTENTION, never safe.",
  BLOCKED: "BLOCKED: DO NOT SEND. This send would likely lose the funds. Tell the human why and how to fix it; don't retry with the same details.",
};

export const INSTRUCTIONS = `Gideon is a read-only pre-send safety check for NEAR. It never signs or moves funds.
Before you send any NEAR or NEAR token, call gideon_check with the exact recipient, network, amount and token, and \`from\` (the account you send from) when you know it.
- BLOCKED (agent_action DO_NOT_SEND): do not send. Report the reason and fix steps to the human.
- ATTENTION (agent_action ASK_HUMAN): do not send on your own. Ask a human and wait for an explicit yes. A lookup that failed ("couldn't check") is ATTENTION, never safe.
- SAFE (agent_action SEND): you may send, with exactly the details you checked. If anything changes, check again.
gideon_explain turns a result into plain words. gideon_flags lists community reports about an account; reports are not proof.`;

/** Your own history (first send, lookalikes of past sends) is info-only: it never holds the answer longer than this. */
export const HISTORY_MS = 4000;

export interface ServerDeps {
  sources?: Sources;
  env?: Record<string, string | undefined>;
  explainer?: Explainer | null;
  /** Fixed clock for tests. */
  now?: number;
}

/** Sources from the environment: GIDEON_REPLAY=<fixtures.json> answers offline from a recording (demos, tests). */
export function sourcesFromEnv(env: Record<string, string | undefined>): Sources {
  if (env.GIDEON_REPLAY) return replaySources(JSON.parse(readFileSync(env.GIDEON_REPLAY, "utf8")).answers);
  return liveSources(sourcesOptionsFromEnv(env));
}

const network = z.enum(["testnet", "mainnet"]).optional().describe("NEAR network. Default: GIDEON_NETWORK, else testnet.");
const checkFields = {
  recipient: z.string().min(1).describe("Exactly what you are about to send to (account, address or whatever was pasted)."),
  network,
  amount: z.string().regex(/^\d+(\.\d+)?$/).optional().describe('Human amount, e.g. "25" or "0.5".'),
  token: z.string().optional().describe('Token symbol. Default "NEAR" (native).'),
  token_contract: z.string().optional().describe("NEP-141 contract for a token send, e.g. usdc.near."),
  destination: z.enum(["wallet", "exchange", "intents", "unknown"]).optional().describe("What the recipient is. Default unknown."),
  exchange: z.string().optional().describe("Exchange id when destination is exchange: generic, binance, coinbase, kraken, okx."),
  from: z.string().optional().describe("The NEAR account you're sending from. Gideon compares the recipient with your own history: BLOCKED if it looks like someone you've sent to (or a dust sender: address poisoning), ATTENTION if you've never sent to it before."),
  sender: z.string().optional().describe("Same as `from` (older name)."),
  address_book: z.array(z.object({ account: z.string(), label: z.string().optional() })).optional().describe("Known-good recipients, for the lookalike check."),
};

const reason = z.object({ rule: z.string(), status: z.string(), code: z.string(), title: z.string(), detail: z.string(), link: z.string().optional().describe("Where to read more, e.g. the public scam report (R14).") });
const checkOutput = z.object({
  verdict: z.enum(["SAFE", "ATTENTION", "BLOCKED"]),
  agent_action: z.enum(["SEND", "ASK_HUMAN", "DO_NOT_SEND"]),
  agent_instruction: z.string(),
  recipient: z.string(),
  network: z.enum(["testnet", "mainnet"]),
  headline: z.string().nullable(),
  account: z.object({
    exists: z.boolean().nullable().describe("true = found on chain, false = not found, null = couldn't check"),
    summary: z.string(),
    balance_near: z.string().optional(),
    created: z.string().optional(),
  }).nullable().describe("Live account lookup on the selected network. Null when the recipient isn't a NEAR account."),
  reasons: z.array(reason),
  fix: z.array(z.string()),
  couldnt_check: z.array(z.string()),
  receipt: z.object({ sha256: z.string(), signature: z.string().optional(), publicKey: z.string().optional() }),
  result: z.record(z.string(), z.unknown()).describe("Full Gideon result. Pass it to gideon_explain as is."),
});

export function summarize(r: CheckResult) {
  const shown = r.findings.filter((f) => f.status !== "SKIPPED" && f.status !== "PASS");
  return {
    verdict: r.verdict,
    agent_action: AGENT_ACTION[r.verdict],
    agent_instruction: INSTRUCTION[r.verdict],
    recipient: r.input.to,
    network: r.input.network,
    headline: r.headline ? `${r.headline.title}${/[.?!]$/.test(r.headline.title) ? "" : "."} ${r.headline.detail}` : null,
    account: r.account
      ? { exists: r.account.exists, summary: r.account.summary,
          ...(r.account.balanceNear !== undefined ? { balance_near: r.account.balanceNear } : {}),
          ...(r.account.createdAt ? { created: r.account.createdAt } : {}) }
      : null,
    reasons: shown.map((f) => {
      const link = f.evidence?.find((e) => e.url)?.url;
      return { rule: f.rule, status: f.status, code: f.code, title: f.title, detail: f.detail, ...(link ? { link } : {}) };
    }),
    fix: r.headline?.fix ?? [],
    couldnt_check: r.findings.filter((f) => f.status === "COULD_NOT_CHECK").map((f) => `${f.rule}: ${f.detail}`),
    receipt: r.receipt,
    result: r as unknown as Record<string, unknown>,
  };
}

function asText(s: ReturnType<typeof summarize>): string {
  const lines = [`${s.verdict} → ${s.agent_action}`, s.agent_instruction, `Recipient: ${s.recipient} (${s.network})`];
  if (s.account) lines.push(`Account: ${s.account.summary}`);
  if (s.headline) lines.push(`Why: ${s.headline}`);
  for (const x of s.reasons) lines.push(`- ${x.rule} ${x.status}: ${x.title}${x.link ? ` (${x.link})` : ""}`);
  s.fix.forEach((f, i) => lines.push(`Fix ${i + 1}: ${f}`));
  lines.push(`Receipt sha256: ${s.receipt.sha256}`);
  return lines.join("\n");
}

export function createGideonServer(deps: ServerDeps = {}): McpServer {
  const env = deps.env ?? process.env;
  const sources = deps.sources ?? sourcesFromEnv(env);
  const explainer = deps.explainer !== undefined ? deps.explainer
    : env.NEARAI_API_KEY ? nearAiExplainer({ apiKey: env.NEARAI_API_KEY, model: env.NEARAI_MODEL || undefined }) : null;
  const net = (n?: string): Network => resolveNetwork(n ?? env.GIDEON_NETWORK);
  const registryFor = (n: Network, arg?: string) => (arg ?? env.GIDEON_FLAG_REGISTRY ?? NETWORKS[n].flagRegistry ?? "") || null;

  async function runCheck(a: { [K in keyof typeof checkFields]?: unknown } & { recipient: string }): Promise<CheckResult> {
    const n = net(a.network as string | undefined);
    const input: CheckInput = {
      to: a.recipient,
      network: n,
      asset: { symbol: (a.token as string) ?? "NEAR", ...(a.token_contract ? { contract: a.token_contract as string } : {}) },
      amount: a.amount as string | undefined,
      destination: (a.destination as CheckInput["destination"]) ?? "unknown",
      exchange: a.exchange as string | undefined,
      from: ((a.from ?? a.sender) as string | undefined) || undefined,
      addressBook: a.address_book as CheckInput["addressBook"],
    };
    const reg = registryFor(n);
    return check(input, sources, {
      now: deps.now,
      receiptKey: env.GIDEON_RECEIPT_KEY || undefined,
      flagRegistry: reg ?? "",
      historyTimeoutMs: HISTORY_MS,
    });
  }

  const server = new McpServer({ name: "gideon", version: VERSION }, { instructions: INSTRUCTIONS });
  const hints = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

  server.registerTool("gideon_check", {
    title: "Check a NEAR send before making it",
    description: "Run Gideon's pre-send checks on a NEAR recipient (wrong network, pasted tx hash, lookalike/address poisoning, token and exchange mismatches, Intents deposits, community flags). " +
      "Returns verdict and agent_action: SAFE→SEND, ATTENTION→ASK_HUMAN, BLOCKED→DO_NOT_SEND. Call it before every send. Read-only; never signs.",
    inputSchema: z.object(checkFields),
    outputSchema: checkOutput,
    annotations: hints,
  }, async (a) => {
    const s = summarize(await runCheck(a));
    return { content: [{ type: "text", text: asText(s) }], structuredContent: s };
  });

  server.registerTool("gideon_explain", {
    title: "Explain a Gideon verdict in plain words",
    description: "Explain a gideon_check result for a human. Pass `result` from gideon_check (preferred, no new lookups), or the same fields as gideon_check to check and explain in one go. " +
      "Uses NEAR AI only if NEARAI_API_KEY is set, otherwise Gideon's built-in text. It never changes the verdict.",
    inputSchema: z.object({ result: z.record(z.string(), z.unknown()).optional().describe("The `result` field from gideon_check."), ...checkFields, recipient: checkFields.recipient.optional() }),
    outputSchema: z.object({ verdict: z.enum(["SAFE", "ATTENTION", "BLOCKED"]), agent_action: z.enum(["SEND", "ASK_HUMAN", "DO_NOT_SEND"]), explanation: z.string(), by: z.string(), receipt_sha256: z.string() }),
    annotations: hints,
  }, async (a) => {
    let r: CheckResult;
    if (a.result) {
      r = a.result as unknown as CheckResult;
      const ok = await verifyReceipt(r).then((v) => v.hashOk && v.signatureOk !== false, () => false);
      if (!ok) return { isError: true, content: [{ type: "text", text: "This result doesn't match its receipt (it was changed or isn't a Gideon result). Run gideon_check again." }] };
    } else if (a.recipient) {
      r = await runCheck({ ...a, recipient: a.recipient });
    } else {
      return { isError: true, content: [{ type: "text", text: "Pass `result` from gideon_check, or a `recipient` to check." }] };
    }
    const e = await explain(r, explainer);
    const out = { verdict: r.verdict, agent_action: AGENT_ACTION[r.verdict], explanation: e.text, by: e.by, receipt_sha256: r.receipt.sha256 };
    return { content: [{ type: "text", text: `${r.verdict} → ${out.agent_action}\n${e.text}` }], structuredContent: out };
  });

  server.registerTool("gideon_flags", {
    title: "Read community flags for a NEAR account",
    description: "List community reports (scam, address poisoning) on a NEAR account from the Gideon flag registry contract (a view call, no key). " +
      "Reports are not proof. If no registry is set or it can't be read, status is COULD_NOT_CHECK, which is not the same as no flags.",
    inputSchema: z.object({
      account: z.string().min(1).describe("NEAR account to look up."),
      network,
      registry: z.string().optional().describe("Registry contract. Default: GIDEON_FLAG_REGISTRY, else the network's configured registry."),
    }),
    outputSchema: z.object({
      status: z.enum(["FLAGGED", "NO_FLAGS", "COULD_NOT_CHECK"]),
      account: z.string(), network: z.enum(["testnet", "mainnet"]), registry: z.string().nullable(),
      flags: z.array(z.object({ reporter: z.string(), reason: z.string(), at_ms: z.number() })),
      message: z.string(),
    }),
    annotations: hints,
  }, async (a) => {
    const n = net(a.network);
    const account = a.account.trim().toLowerCase();
    const registry = registryFor(n, a.registry);
    const out = (status: "FLAGGED" | "NO_FLAGS" | "COULD_NOT_CHECK", message: string, flags: { reporter: string; reason: string; at_ms: number }[] = []) => {
      const s = { status, account, network: n, registry, flags, message };
      const lines = [`${status}: ${message}`, ...flags.map((f) => `- ${f.reporter}: ${f.reason}`)];
      return { content: [{ type: "text" as const, text: lines.join("\n") }], structuredContent: s };
    };
    if (!registry) return out("COULD_NOT_CHECK", `Couldn't check: no community flag registry is set for ${n} (it isn't deployed yet). This is not the same as "no flags".`);
    let flags;
    try { flags = await sources.communityFlags(n, registry, account); }
    catch (e) { return out("COULD_NOT_CHECK", `Couldn't check: reading ${registry} failed (${e instanceof Error ? e.message : String(e)}).`); }
    if (flags === null) return out("COULD_NOT_CHECK", `Couldn't check: the flag registry ${registry} isn't deployed on ${n}.`);
    if (!flags.length) return out("NO_FLAGS", `Nobody has flagged ${account} in ${registry}. That isn't proof it's safe.`);
    return out("FLAGGED", `${flags.length} ${flags.length === 1 ? "person has" : "people have"} flagged ${account}. Reports, not proof: ask a human before sending.`, flags);
  });

  return server;
}
