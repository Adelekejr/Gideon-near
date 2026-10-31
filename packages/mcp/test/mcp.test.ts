import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { Sources } from "@gideon/core";
import { createGideonServer } from "../src/server.js";
import { encodeTransaction, toBase64 } from "@gideon/core";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const down = async (): Promise<never> => { throw new Error("source down"); };
const sources = (over: Partial<Sources> = {}): Sources => ({
  viewAccount: async () => null, tronTx: async () => null, ethTx: async () => null, btcTx: async () => null,
  ftMetadata: async () => null, storageRegistered: async () => false, oneClickStatus: async () => null,
  recentTransfers: async () => [], nearTx: async () => null, communityFlags: async () => [], ...over,
});
const person = async () => ({ amountYocto: "5000000000000000000000000", codeHash: "11111111111111111111111111111111", storageUsage: 182 });

let open: Client[] = [];
afterEach(async () => { await Promise.all(open.map((c) => c.close())); open = []; });

async function connect(deps: Parameters<typeof createGideonServer>[0]) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createGideonServer({ now: NOW, env: {}, ...deps }).connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  open.push(client);
  return client;
}
const call = async (c: Client, name: string, args: Record<string, unknown>) => (await c.callTool({ name, arguments: args })) as any;

describe("gideon MCP server", () => {
  it("adds the drained-wallet check (R18): two swept senders BLOCK, and the receipt still verifies", async () => {
    const to = "collector.testnet";
    const T = NOW - 3_600_000;
    const victim = (name: string, i: number) => {
      const add = { hash: `a${i}`, signer: name, signerKey: `old-${name}`, receiver: name, timestampMs: T - 60_000, blockHeight: 100 + i * 10, actions: [{ kind: "addKey" as const, publicKey: `new-${name}`, fullAccess: true }] };
      const drain = { hash: `d${i}`, signer: name, signerKey: `new-${name}`, receiver: to, timestampMs: T, blockHeight: 101 + i * 10, actions: [{ kind: "transfer" as const, depositYocto: "1000" }] };
      return { name, add, drain };
    };
    const vs = [victim("a.testnet", 1), victim("b.testnet", 2)];
    const dust = { amountYocto: "50000000000000000000000", codeHash: "11111111111111111111111111111111", storageUsage: 182 };
    const c = await connect({ sources: sources({
      viewAccount: async (_n, a) => (a === to ? person() : dust),
      inboundTxs: async () => ({ total: 2, txs: vs.map((v) => v.drain) }),
      signedTxsUpTo: async (_n, a, h) => { const v = vs.find((x) => x.name === a)!; return [v.drain, v.add].filter((x) => x.blockHeight <= h); },
    }) });
    const r = await call(c, "gideon_check", { recipient: to, network: "testnet", amount: "1", destination: "wallet" });
    expect(r.structuredContent.verdict).toBe("BLOCKED");
    expect(r.structuredContent.reasons.some((x: { rule: string }) => x.rule === "R18")).toBe(true);
    const e = await call(c, "gideon_explain", { result: r.structuredContent.result });
    expect(e.isError).toBeFalsy();
    expect(e.structuredContent.verdict).toBe("BLOCKED");
  });

  it("without a transaction source the drained-wallet check stays silent", async () => {
    const c = await connect({ sources: sources({ viewAccount: person }) });
    const r = await call(c, "gideon_check", { recipient: "kemi-rent.testnet", network: "testnet", amount: "1", destination: "wallet" });
    expect(r.structuredContent.verdict).toBe("SAFE");
  });

  it("lists the read-only tools and tells agents the policy", async () => {
    const c = await connect({ sources: sources() });
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["gideon_account_health", "gideon_check", "gideon_check_transaction", "gideon_explain", "gideon_flags"]);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
    const ins = c.getInstructions() ?? "";
    expect(ins).toMatch(/BLOCKED.*do not send/i);
    expect(ins).toMatch(/ATTENTION.*ask a human/i);
  });

  it("BLOCKED → DO_NOT_SEND with fix steps and a receipt", async () => {
    const c = await connect({ sources: sources() });
    const r = await call(c, "gideon_check", { recipient: "alice.near", network: "testnet", amount: "1" });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.verdict).toBe("BLOCKED");
    expect(r.structuredContent.agent_action).toBe("DO_NOT_SEND");
    expect(r.structuredContent.fix.length).toBeGreaterThan(0);
    expect(r.structuredContent.receipt.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.content[0].text).toMatch(/^BLOCKED → DO_NOT_SEND/);
  });

  it("SAFE → SEND for a normal account with every source answering", async () => {
    const c = await connect({ sources: sources({ viewAccount: person }) });
    const r = await call(c, "gideon_check", { recipient: "kemi-rent.testnet", network: "testnet", amount: "1", destination: "wallet" });
    expect(r.structuredContent.verdict).toBe("SAFE");
    expect(r.structuredContent.agent_action).toBe("SEND");
    expect(r.structuredContent.account.exists).toBe(true);
    expect(r.structuredContent.account.summary).toMatch(/^Account exists on NEAR testnet/);
    expect(r.content[0].text).toMatch(/Account: Account exists on NEAR testnet/);
  });

  it("an account that doesn't exist → BLOCKED with account.exists false", async () => {
    const c = await connect({ sources: sources({ viewAccount: async () => null }) });
    const r = await call(c, "gideon_check", { recipient: "adelekejr-nope.testnet", network: "testnet", amount: "1" });
    expect(r.structuredContent.verdict).toBe("BLOCKED");
    expect(r.structuredContent.account.exists).toBe(false);
    expect(r.structuredContent.headline).toMatch(/doesn't exist on NEAR testnet/);
  });

  it("a failed lookup is ATTENTION → ASK_HUMAN, never SAFE", async () => {
    const c = await connect({ sources: sources({ viewAccount: down }) });
    const r = await call(c, "gideon_check", { recipient: "kemi-rent.testnet", network: "testnet", amount: "1" });
    expect(r.structuredContent.verdict).toBe("ATTENTION");
    expect(r.structuredContent.agent_action).toBe("ASK_HUMAN");
    expect(r.structuredContent.couldnt_check.length).toBeGreaterThan(0);
    expect(r.structuredContent.account.exists).toBeNull();
  });

  it("network defaults to GIDEON_NETWORK", async () => {
    const c = await connect({ sources: sources(), env: { GIDEON_NETWORK: "mainnet" } });
    const r = await call(c, "gideon_check", { recipient: "bob.testnet" });
    expect(r.structuredContent.network).toBe("mainnet");
    expect(r.structuredContent.verdict).toBe("BLOCKED");
  });

  it("rejects bad input as a tool error", async () => {
    const c = await connect({ sources: sources() });
    const r = await call(c, "gideon_check", { recipient: "a.testnet", network: "devnet" });
    expect(r.isError).toBe(true);
  });

  it("explain: deterministic text without a key, from a passed result", async () => {
    const c = await connect({ sources: sources(), explainer: null });
    const chk = await call(c, "gideon_check", { recipient: "alice.near", network: "testnet" });
    const e = await call(c, "gideon_explain", { result: chk.structuredContent.result });
    expect(e.isError).toBeFalsy();
    expect(e.structuredContent.by).toBe("built-in");
    expect(e.structuredContent.verdict).toBe("BLOCKED");
    expect(e.structuredContent.explanation.length).toBeGreaterThan(20);
    expect(e.structuredContent.receipt_sha256).toBe(chk.structuredContent.receipt.sha256);
  });

  it("explain: refuses a result that was edited after the check", async () => {
    const c = await connect({ sources: sources(), explainer: null });
    const chk = await call(c, "gideon_check", { recipient: "alice.near", network: "testnet" });
    const forged = { ...chk.structuredContent.result, verdict: "SAFE" };
    const e = await call(c, "gideon_explain", { result: forged });
    expect(e.isError).toBe(true);
  });

  it("explain: uses the optional explainer when given, and can check in one go", async () => {
    const c = await connect({ sources: sources(), explainer: { name: "near-ai", explain: async () => "Plain words." } });
    const e = await call(c, "gideon_explain", { recipient: "alice.near", network: "testnet" });
    expect(e.structuredContent.by).toMatch(/near-ai/);
    expect(e.structuredContent.explanation).toBe("Plain words.");
  });

  it("flags: COULD_NOT_CHECK when no registry is set", async () => {
    const c = await connect({ sources: sources() });
    const r = await call(c, "gideon_flags", { account: "x.testnet", network: "testnet" });
    expect(r.structuredContent.status).toBe("COULD_NOT_CHECK");
    expect(r.structuredContent.registry).toBeNull();
  });

  it("flags: reads the registry, and treats a missing or failing one as COULD_NOT_CHECK", async () => {
    const flag = { reporter: "kemi.testnet", reason: "address poisoning", at_ms: NOW };
    let c = await connect({ sources: sources({ communityFlags: async () => [flag] }), env: { GIDEON_FLAG_REGISTRY: "flags.gideon.testnet" } });
    let r = await call(c, "gideon_flags", { account: "Bad.testnet" });
    expect(r.structuredContent).toMatchObject({ status: "FLAGGED", account: "bad.testnet", registry: "flags.gideon.testnet", flags: [flag] });
    c = await connect({ sources: sources({ communityFlags: async () => null }) });
    r = await call(c, "gideon_flags", { account: "bad.testnet", registry: "nope.testnet" });
    expect(r.structuredContent.status).toBe("COULD_NOT_CHECK");
    c = await connect({ sources: sources({ communityFlags: down }) });
    r = await call(c, "gideon_flags", { account: "bad.testnet", registry: "flags.gideon.testnet" });
    expect(r.structuredContent.status).toBe("COULD_NOT_CHECK");
    c = await connect({ sources: sources() });
    r = await call(c, "gideon_flags", { account: "ok.testnet", registry: "flags.gideon.testnet" });
    expect(r.structuredContent.status).toBe("NO_FLAGS");
  });
});

describe("stdio end to end (built server, recorded answers, no network)", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const { cases } = JSON.parse(readFileSync(`${root}demo/cases.json`, "utf8"));

  it("every demo case gets its expected verdict over a real stdio MCP connection", async () => {
    const t = new StdioClientTransport({
      command: process.execPath,
      args: [`${root}packages/mcp/dist/index.js`],
      env: { PATH: process.env.PATH ?? "", GIDEON_REPLAY: `${root}demo/fixtures.json` },
      stderr: "ignore",
    });
    const c = new Client({ name: "e2e", version: "0" });
    await c.connect(t);
    open.push(c);
    for (const k of cases) {
      const i = k.input;
      const r = (await c.callTool({ name: "gideon_check", arguments: {
        recipient: i.to, network: i.network, amount: i.amount, token: i.asset?.symbol, token_contract: i.asset?.contract,
        destination: i.destination, exchange: i.exchange, sender: i.from, address_book: i.addressBook,
      } })) as any;
      expect([k.id, r.structuredContent?.verdict, r.structuredContent?.result?.headline?.code ?? null]).toEqual([k.id, k.expect.verdict, k.expect.headline]);
    }
  }, 30000);
});

describe("compatibility and demo", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process");

  it("answers an older MCP host (protocol 2024-11-05) over stdio", () => {
    const lines = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "old-host", version: "0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "gideon_check", arguments: { recipient: "alice.near", network: "testnet" } } },
    ].map((m) => JSON.stringify(m)).join("\n") + "\n";
    const p = spawnSync(process.execPath, [`${root}packages/mcp/dist/index.js`], { input: lines, env: { PATH: process.env.PATH ?? "", GIDEON_REPLAY: `${root}demo/fixtures.json` }, encoding: "utf8", timeout: 8000 });
    const msgs = p.stdout.trim().split("\n").map((l) => JSON.parse(l));
    expect(msgs.find((m) => m.id === 1).result.protocolVersion).toBe("2024-11-05");
    expect(msgs.find((m) => m.id === 2).result.structuredContent.agent_action).toBe("DO_NOT_SEND");
  });

  it("the demo agent stops on BLOCKED and never reaches the next payout", () => {
    const p = spawnSync(process.execPath, [`${root}packages/mcp/demo/agent.mjs`, "--offline"], { encoding: "utf8", timeout: 15000, env: { ...process.env, NO_COLOR: "1" } });
    expect(p.status).toBe(2);
    expect(p.stdout).toMatch(/BLOCKED \(DO_NOT_SEND\)/);
    expect(p.stdout).toMatch(/4\/4 Vendor invoice: not attempted/);
    expect(p.stdout).toMatch(/No transaction was signed/);
  });
});

describe("gideon_check `from` (sender history)", () => {
  const me = "me.testnet";
  const real = "a1b2" + "0".repeat(56) + "c3d4";
  const fakeAddr = "a1b2" + "f".repeat(56) + "c3d4";
  it("first send → ATTENTION / ASK_HUMAN with the first-send reason", async () => {
    const c = await connect({ sources: sources({ viewAccount: person, sentCount: async () => 0 }) });
    const r = await call(c, "gideon_check", { recipient: "kemi-rent.testnet", network: "testnet", from: me, destination: "wallet" });
    expect(r.structuredContent.agent_action).toBe("ASK_HUMAN");
    expect(r.structuredContent.reasons.map((x: any) => x.code)).toContain("FIRST_SEND");
  });
  it("sent before → SAFE", async () => {
    const c = await connect({ sources: sources({ viewAccount: person, sentCount: async () => 2 }) });
    const r = await call(c, "gideon_check", { recipient: "kemi-rent.testnet", network: "testnet", from: me, destination: "wallet" });
    expect(r.structuredContent.verdict).toBe("SAFE");
  });
  it("lookalike of a past recipient → DO_NOT_SEND (old `sender` name still works)", async () => {
    const hist = sources({ viewAccount: person, recentTransfers: async () => [{ hash: "t", signer: me, receiver: real, depositYocto: 1e24 }], sentCount: async () => 0 });
    for (const key of ["from", "sender"]) {
      const c = await connect({ sources: hist });
      const r = await call(c, "gideon_check", { recipient: fakeAddr, network: "testnet", [key]: me });
      expect(r.structuredContent.agent_action).toBe("DO_NOT_SEND");
      expect(r.structuredContent.reasons[0].code).toBe("LOOKALIKE_OF_PAST_RECIPIENT");
    }
  });
  it("history down → no first-send note, verdict unaffected", async () => {
    const c = await connect({ sources: sources({ viewAccount: person, recentTransfers: down, sentCount: down }) });
    const r = await call(c, "gideon_check", { recipient: "kemi-rent.testnet", network: "testnet", from: me, destination: "wallet" });
    expect(r.structuredContent.verdict).toBe("SAFE");
    expect(r.structuredContent.couldnt_check).toEqual([]);
  });
  it("the schema documents `from`", async () => {
    const c = await connect({ sources: sources() });
    const t = (await c.listTools()).tools.find((x) => x.name === "gideon_check")!;
    expect((t.inputSchema.properties as Record<string, any>).from.description).toMatch(/never sent/);
  });

  describe("gideon_check_transaction", () => {
    const KEY = "ed25519:" + "1".repeat(43);
    it("BLOCKS a full-access AddKey given as signer, receiver and actions", async () => {
      const c = await connect({ sources: sources() });
      const r = await call(c, "gideon_check_transaction", { signer: "me.testnet", receiver: "me.testnet", network: "testnet",
        actions: [{ type: "AddKey", params: { publicKey: KEY, accessKey: { permission: "FullAccess" } } }] });
      expect(r.structuredContent.verdict).toBe("BLOCKED");
      expect(r.structuredContent.agent_action).toBe("DO_NOT_SEND");
      expect(r.structuredContent.reasons[0].code).toBe("FULL_ACCESS_KEY");
      expect(r.structuredContent.transactions[0].actions).toEqual(["AddKey FullAccess"]);
    });
    it("reads raw base64 and a sign link the same way", async () => {
      const c = await connect({ sources: sources() });
      const b64 = toBase64(encodeTransaction({ signerId: "me.testnet", publicKey: KEY, receiverId: "me.testnet", actions: [{ type: "AddKey", publicKey: KEY, fullAccess: true }] }));
      const a = await call(c, "gideon_check_transaction", { request: b64 });
      const b = await call(c, "gideon_check_transaction", { request: `https://testnet.mynearwallet.com/sign?transactions=${encodeURIComponent(b64)}&callbackUrl=https%3A%2F%2Fevil.example` });
      expect([a.structuredContent.verdict, b.structuredContent.verdict]).toEqual(["BLOCKED", "BLOCKED"]);
      expect(b.structuredContent.network).toBe("testnet");
    });
    it("a well-known call is SAFE once the accounts are read live, couldn't-check when lookups fail; bad input is a plain error", async () => {
      const args = { signer: "me.near", receiver: "wrap.near", network: "mainnet",
        actions: [{ type: "FunctionCall", params: { methodName: "near_deposit", args: {}, gas: "30000000000000", deposit: "1000000000000000000000000" } }] };
      // 0.3.1: never SAFE without a real check, so a request read with every lookup down is ATTENTION.
      const offline = await call(await connect({ sources: sources({ viewAccount: down }) }), "gideon_check_transaction", args);
      expect(offline.structuredContent.verdict).toBe("ATTENTION");
      expect(offline.structuredContent.agent_action).toBe("ASK_HUMAN");
      const c = await connect({ sources: sources({ viewAccount: person }) });
      const r = await call(c, "gideon_check_transaction", args);
      expect(r.structuredContent.verdict).toBe("SAFE");
      const e = await call(c, "gideon_check_transaction", { request: "https://example.com/hi" });
      expect(e.isError).toBe(true);
      expect(e.content[0].text).toMatch(/isn't a wallet sign/);
      const n = await call(c, "gideon_check_transaction", {});
      expect(n.isError).toBe(true);
    });
    it("0.3.2: tokens moved through intents get the address checks, and an amount it can't read is never green", async () => {
      const c = await connect({ sources: sources({ viewAccount: person, sentCount: async () => 0 }) });
      const mt = await call(c, "gideon_check_transaction", { signer: "me.near", receiver: "intents.near", network: "mainnet",
        actions: [{ type: "FunctionCall", params: { methodName: "mt_transfer", args: { receiver_id: "bigbank101.near", token_id: "nep141:wrap.near", amount: "5" }, gas: "30000000000000", deposit: "1" } }] });
      expect(mt.structuredContent.agent_action).toBe("DO_NOT_SEND");
      const odd = await call(c, "gideon_check_transaction", { signer: "me.near", receiver: "wrap.near", network: "mainnet",
        actions: [{ type: "FunctionCall", params: { methodName: "near_deposit", args: {}, gas: "30000000000000", deposit: "1e30" } }] });
      expect(odd.structuredContent.verdict).toBe("ATTENTION");
      expect(odd.structuredContent.agent_action).toBe("ASK_HUMAN");
      const key = await call(c, "gideon_check_transaction", { signer: "me.near", receiver: "intents.near", network: "mainnet",
        actions: [{ type: "FunctionCall", params: { methodName: "add_public_key", args: { public_key: KEY }, gas: "30000000000000", deposit: "1" } }] });
      expect(key.structuredContent.reasons[0].code).toBe("CONTRACT_KEY");
    });
  });
});

describe("gideon_account_health", () => {
  const K1 = "ed25519:DLZLLsmQK9RMa3FM3hXG6yYYrnPZrW8ZgMdiNwpiGiCz";
  const K2 = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp";
  const DAY = 86_400_000;
  it("puts an any-method app key on the tidy list (clean) and gives a ready-to-sign removal, never for the wallet key", async () => {
    const c = await connect({ sources: sources({
      viewAccount: person,
      accessKeys: async () => [
        { publicKey: K1, nonce: "120000000000009", permission: "FullAccess" },
        { publicKey: K2, nonce: "0", permission: { receiverId: "social.near", methodNames: [], allowanceYocto: null } },
      ],
      keyRecords: async () => [{ publicKey: K2, fullAccess: false, createdMs: NOW - 10 * DAY, createdTx: null, deletedMs: null, deletedTx: null }],
      signedTxs: async () => [],
    }) });
    const r = await call(c, "gideon_account_health", { account: "me.near" });
    const s = r.structuredContent;
    expect(s).toMatchObject({ status: "clean", red: false, move_funds_now: false, network: "mainnet", counts: { flagged: 0, tidy: 1 } });
    expect(s.keys.find((k: any) => k.public_key === K1).probable_wallet_key).toBe(true);
    expect(s.remove_links.map((l: any) => l.public_key)).toEqual([K2]);
    expect(s.remove_links[0].mynearwallet).toMatch(/^https:\/\/app\.mynearwallet\.com\/sign\?transactions=.*&callbackUrl=https%3A%2F%2Fnearblocks\.io%2Faddress%2Fme\.near$/);
    expect(s.remove_links[0]).toMatchObject({
      kind: "app", tidy: true, flagged: false, callback_url: "https://nearblocks.io/address/me.near",
      action: { type: "DeleteKey", params: { publicKey: K2 } },
      near_mcp: { tool: "account_delete_access_keys", args: { accountId: "me.near", networkId: "mainnet", publicKey: K2 } },
      near_cli: `near account delete-keys me.near public-keys ${K2} network-config mainnet sign-with-keychain send`,
    });
    expect(new URL(s.remove_links[0].meteor).searchParams.get("transactions")).toBe(s.remove_links[0].transaction_base64);
    expect(r.content[0].text).toMatch(/near-mcp: account_delete_access_keys \{"accountId":"me\.near"/);
    expect(r.content[0].text).toMatch(/never sign them yourself/);
  });
  it("a missing account and bad input", async () => {
    const c = await connect({ sources: sources({ accessKeys: async () => null }) });
    expect((await call(c, "gideon_account_health", { account: "gone.testnet" })).structuredContent.status).toBe("not-found");
    expect((await call(c, "gideon_account_health", { account: "hello world!" })).isError).toBe(true);
  });
});

describe("0.3.1 fixes on the MCP surface", () => {
  it("SAFE stays the machine value; the text says 'No problems found', not a promise", async () => {
    const c = await connect({ sources: sources({ viewAccount: person }) });
    const r = await call(c, "gideon_check", { recipient: "kemi-rent.testnet", network: "testnet", amount: "1", destination: "wallet", from: "me.testnet" });
    expect(r.structuredContent.verdict).toBe("SAFE");
    expect(r.structuredContent.agent_action).toBe("SEND");
    expect(r.content[0].text).toMatch(/^SAFE → SEND \(No problems found\)/);
    expect(r.structuredContent.agent_instruction).toMatch(/isn't a guarantee/);
    expect(r.structuredContent.agent_instruction).not.toMatch(/every check that applies passed/);
  });
  it("no sender: the 'Not checked: your send history' line is returned and printed", async () => {
    const c = await connect({ sources: sources({ viewAccount: person }) });
    const r = await call(c, "gideon_check", { recipient: "kemi-rent.testnet", network: "testnet", amount: "1", destination: "wallet" });
    expect(r.structuredContent.not_checked[0]).toMatch(/^Not checked: your send history/);
    expect(r.content[0].text).toMatch(/Not checked: your send history/);
  });
  it("a failed drained-wallet lookup (R18) is reported as not checked, not dropped", async () => {
    const c = await connect({ sources: sources({ viewAccount: person, inboundTxs: down, signedTxsUpTo: down }) });
    const r = await call(c, "gideon_check", { recipient: "kemi-rent.testnet", network: "testnet", amount: "1", destination: "wallet", from: "me.testnet" });
    expect(r.structuredContent.not_checked).toContain("Not checked: couldn't check recent senders for hacked wallets.");
  });
  it("check_transaction: DeleteAccount and DeployContract are BLOCKED, Stake is ATTENTION, SAFE reads 'Nothing flagged'", async () => {
    const c = await connect({ sources: sources({ viewAccount: person }) });
    const tx = (actions: unknown[]) => call(c, "gideon_check_transaction", { signer: "me.testnet", receiver: "me.testnet", network: "testnet", actions });
    expect((await tx([{ type: "DeleteAccount", params: { beneficiaryId: "thief.testnet" } }])).structuredContent.verdict).toBe("BLOCKED");
    expect((await tx([{ type: "DeployContract", params: { code: [0, 97, 115, 109] } }])).structuredContent.verdict).toBe("BLOCKED");
    expect((await tx([{ type: "Stake", params: { stake: "1000000000000000000000000", publicKey: "ed25519:11111111111111111111111111111111" } }])).structuredContent.verdict).toBe("ATTENTION");
    const ok = await call(c, "gideon_check_transaction", { signer: "me.near", receiver: "wrap.near", network: "mainnet",
      actions: [{ type: "FunctionCall", params: { methodName: "near_deposit", args: {}, gas: "30000000000000", deposit: "1000000000000000000000000" } }] });
    expect(ok.content[0].text).toMatch(/^SAFE → SEND \(Nothing flagged\)/);
    expect(ok.structuredContent.agent_instruction).toMatch(/isn't a guarantee/);
  });
});
