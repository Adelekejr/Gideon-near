import { describe, expect, it } from "vitest";
import { checkTransaction } from "../src/tx/check.js";
import { drainerCheck } from "../src/drainer.js";
import { movesFromFastNear, movesFromNearBlocks } from "../src/activity.js";
import { judgeUnusual } from "../src/amounts.js";
import { notCheckedLines, VERDICT_TEXT } from "../src/text.js";
import type { AccountMove, Sources } from "../src/types.js";
import { acct, empty, find, run } from "./helpers.js";

const USDT = "usdt.tether-token.near";
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const me = "me.near";
const live = (over: Partial<Sources> = {}) => empty({
  viewAccount: async () => acct(20),
  sentCount: async () => 3,
  ftMetadata: async () => ({ name: "Tether USD", symbol: "USDT", decimals: 6 }),
  storageRegistered: async () => true,
  ...over,
});

const usdtOut = (n: number, i: number): AccountMove => ({
  hash: `h${i}`, atMs: 1_000 + i, direction: "out", asset: USDT, counterparty: `payee${i}.near`, amount: String(n * 1_000_000),
});

describe("R19 amount much larger than usual", () => {
  it("usual ~100 USDT and this check is 2,000 → LOOK AGAIN, in plain words", async () => {
    const r = await run({
      to: "bob.near", network: "mainnet", from: me, amount: "2000",
      asset: { symbol: "USDT", contract: USDT },
    }, live({ accountActivity: async () => [usdtOut(100, 1), usdtOut(90, 2), usdtOut(110, 3)] }));
    const x = find(r, "R19")[0]!;
    expect(x).toMatchObject({ status: "ATTENTION", code: "UNUSUAL_AMOUNT", title: "You have not sent this much before" });
    expect(x.detail).toMatch(/around 100 USDT/);
    expect(x.detail).toMatch(/2,000 USDT/);
    expect(x.detail).toMatch(/have not sent this much|Look again/);
    expect(r.verdict).toBe("ATTENTION");
    expect(r.verdict).not.toBe("BLOCKED");
  });

  it("an amount in line with recent sends passes", async () => {
    const r = await run({
      to: "bob.near", network: "mainnet", from: me, amount: "100",
      asset: { symbol: "USDT", contract: USDT },
    }, live({ accountActivity: async () => [usdtOut(100, 1), usdtOut(90, 2), usdtOut(110, 3)] }));
    expect(find(r, "R19")[0]).toMatchObject({ status: "PASS", code: "USUAL_AMOUNT" });
    expect(r.verdict).toBe("SAFE");
  });

  it("no earlier sends is not called unusual, and not called safe-by-comparison", async () => {
    const r = await run({ to: "bob.near", network: "mainnet", from: me, amount: "2000", asset: { symbol: "USDT", contract: USDT } },
      live({ accountActivity: async () => [] }));
    expect(find(r, "R19")[0]).toMatchObject({ status: "SKIPPED", code: "NOT_APPLICABLE" });
    expect(r.verdict).toBe("SAFE");
  });

  it("no sender: the amount rule does not pass", async () => {
    const r = await run({ to: "bob.near", network: "mainnet", amount: "2000", asset: { symbol: "USDT", contract: USDT } }, live());
    expect(find(r, "R19")[0]).toMatchObject({ status: "SKIPPED", code: "AMOUNT_NO_SENDER" });
    expect(notCheckedLines(r)).toContain(VERDICT_TEXT.amountNoSender);
    expect(find(r, "R19")[0]!.status).not.toBe("PASS");
  });

  it("a failed history lookup is COULD_NOT_CHECK, never SAFE", async () => {
    const r = await run({
      to: "bob.near", network: "mainnet", from: me, amount: "50", asset: { symbol: "NEAR" },
    }, live({ recentTransfers: async () => { throw new Error("NearBlocks rate limit reached"); } }));
    expect(find(r, "R19")[0]).toMatchObject({ status: "COULD_NOT_CHECK", code: "AMOUNT_HISTORY_FAILED" });
    expect(r.verdict).toBe("ATTENTION");
  });

  it("judgeUnusual: 100 vs 2000 is unusual; 100 vs 150 is not; one sample is not a usual", () => {
    expect(judgeUnusual(2000, [100, 90, 110])).toBe("unusual");
    expect(judgeUnusual(150, [100, 90, 110])).toBe("usual");
    expect(judgeUnusual(2000, [100])).toBe("none");
  });
});

const inflow = (who: string, asset: string, at: number): AccountMove => ({
  hash: `in-${who}-${asset}`, atMs: at, direction: "in", asset, counterparty: who, amount: "1000000",
});
const outflow = (at: number): AccountMove => ({
  hash: `out-${at}`, atMs: at + 60_000, direction: "out", asset: "NEAR", counterparty: "collector-out.near", amount: (10n ** 24n).toString(),
});

function collectorMoves(): AccountMove[] {
  const assets = ["NEAR", USDT, USDC, "wrap.near"];
  const moves: AccountMove[] = [];
  for (let i = 0; i < 6; i++) {
    const at = 1_700_000_000_000 + i * 60_000;
    moves.push(inflow(`sender${i}.near`, assets[i % assets.length]!, at));
    moves.push(outflow(at));
  }
  return moves;
}

describe("R20 collector pattern and exchange allowlist", () => {
  it("many senders, mixed tokens, funds forwarded quickly → LOOK AGAIN, not BLOCKED", async () => {
    const r = await run({ to: "collector.near", network: "mainnet" }, live({ accountActivity: async () => collectorMoves() }));
    const x = find(r, "R20")[0]!;
    expect(x.status).toBe("ATTENTION");
    expect(x.code).toBe("COLLECTOR_PATTERN");
    expect(x.detail).toMatch(/not a block|Exchanges and busy apps/);
    expect(r.verdict).toBe("ATTENTION");
  });

  it("a known exchange is named and is not treated as a drainer", async () => {
    const r = await run({ to: "binancecold3.near", network: "mainnet" }, live({ accountActivity: async () => collectorMoves() }));
    const x = find(r, "R20")[0]!;
    expect(x).toMatchObject({ status: "PASS", code: "KNOWN_EXCHANGE" });
    expect(x.title).toMatch(/Known exchange/);
    expect(x.detail).toMatch(/does not treat it as a drainer/);
    expect(x.detail).toMatch(/deposit address/i);
    expect(r.findings.some((f) => f.code === "COLLECTOR_PATTERN")).toBe(false);
    expect(r.verdict).not.toBe("BLOCKED");
    const d = await drainerCheck({ to: "binancecold3.near", network: "mainnet" }, live({
      inboundTxs: async () => ({ total: 2, txs: [] }),
      signedTxsUpTo: async () => [],
    }));
    expect(d.code).toBe("BUSY_ACCOUNT");
  });

  it("a failed activity lookup is COULD_NOT_CHECK, never a pass", async () => {
    const r = await run({ to: "collector.near", network: "mainnet" }, live({ accountActivity: async () => { throw new Error("down"); } }));
    expect(find(r, "R20")[0]).toMatchObject({ status: "COULD_NOT_CHECK", code: "COLLECTOR_UNKNOWN" });
    expect(r.verdict).toBe("ATTENTION");
  });

  it("no activity source leaves the rule out", async () => {
    const r = await run({ to: "bob.near", network: "mainnet" }, live());
    expect(find(r, "R20")[0]!.status).toBe("SKIPPED");
  });
});

describe("activity parsers", () => {
  it("reads FastNEAR ft_transfer amounts and ignores 1-yocto call deposits", () => {
    const raw = "100000000";
    const args = Buffer.from(JSON.stringify({ receiver_id: "bob.near", amount: raw })).toString("base64");
    const moves = movesFromFastNear("me.near", [{
      transaction: {
        hash: "T", signer_id: "me.near", receiver_id: USDT,
        actions: [
          { FunctionCall: { method_name: "ft_transfer", args, deposit: "1" } },
        ],
      },
      execution_outcome: { block_timestamp: 1_700_000_000_000_000_000 },
    }]);
    expect(moves).toEqual([
      { hash: "T", atMs: 1_700_000_000_000, direction: "out", asset: USDT, counterparty: "bob.near", amount: raw },
    ]);
  });

  it("reads a NearBlocks ft_transfer", () => {
    const moves = movesFromNearBlocks("bob.near", [{
      transaction_hash: "N", signer_account_id: "me.near", receiver_account_id: USDT, block_timestamp: "1700000000000000000",
      actions: [{ action: "FUNCTION_CALL", method: "ft_transfer", args: JSON.stringify({ receiver_id: "bob.near", amount: "25000000" }) }],
    }]);
    expect(moves[0]).toMatchObject({ direction: "in", asset: USDT, counterparty: "me.near", amount: "25000000" });
  });
});

describe("T7 swap and bridge minimum, and the send/receive preview", () => {
  const swap = (min: string) => ({
    signerId: me, receiverId: "v2.ref-finance.near",
    actions: [{ type: "FunctionCall", params: {
      methodName: "swap", gas: "1", deposit: "1",
      args: { actions: [{ pool_id: 1, token_in: USDT, token_out: USDC, amount_in: "1000000000", min_amount_out: min }] },
    } }],
  });

  it("1,000 → 50 is LOOK AGAIN, with a plain preview", async () => {
    const r = await checkTransaction({ request: swap("50000000"), network: "mainnet" }, live(), { drainerTimeoutMs: 2000 });
    const x = r.findings.find((f) => f.rule === "T7")!;
    expect(x).toMatchObject({ status: "ATTENTION", code: "MIN_OUT_LOW" });
    expect(x.detail).toMatch(/1,000 USDT/);
    expect(x.detail).toMatch(/50 USDC/);
    expect(r.verdict).toBe("ATTENTION");
    expect(r.preview).toEqual(expect.arrayContaining([
      expect.stringMatching(/^You send 1,000 USDT/),
      expect.stringMatching(/^You receive at least 50 USDC/),
    ]));
  });

  it("a close minimum is not flagged", async () => {
    const r = await checkTransaction({ request: swap("900000000"), network: "mainnet" }, live(), { drainerTimeoutMs: 2000 });
    expect(r.findings.some((f) => f.code === "MIN_OUT_LOW")).toBe(false);
    expect(r.verdict).toBe("SAFE");
  });

  it("a swap whose args can't be read is COULD_NOT_CHECK", async () => {
    const r = await checkTransaction({ request: {
      signerId: me, receiverId: "v2.ref-finance.near",
      actions: [{ type: "FunctionCall", params: { methodName: "swap", args: "not json", gas: "1", deposit: "1" } }],
    }, network: "mainnet" }, live(), { drainerTimeoutMs: 2000 });
    expect(r.findings.find((f) => f.rule === "T7")).toMatchObject({ status: "COULD_NOT_CHECK", code: "MIN_OUT_UNREADABLE" });
    expect(r.verdict).toBe("ATTENTION");
  });

  it("a bridge floor far below the amount in is LOOK AGAIN", async () => {
    const r = await checkTransaction({ request: {
      signerId: me, receiverId: USDT,
      actions: [{ type: "FunctionCall", params: {
        methodName: "ft_transfer_call", gas: "1", deposit: "1",
        args: {
          receiver_id: "v2.omni.hot.tg", amount: "1000000000",
          msg: JSON.stringify({ min_amount_out: "50000000", token_out: USDC }),
        },
      } }],
    }, network: "mainnet" }, live(), { drainerTimeoutMs: 2000 });
    expect(r.findings.find((f) => f.code === "MIN_OUT_LOW")?.status).toBe("ATTENTION");
    expect(r.preview?.some((p) => p.startsWith("You send 1,000 USDT"))).toBe(true);
  });

  it("a send much larger than recent history is LOOK AGAIN on the transaction too", async () => {
    const r = await checkTransaction({ request: {
      signerId: me, receiverId: USDT,
      actions: [{ type: "FunctionCall", params: { methodName: "ft_transfer", args: { receiver_id: "bob.near", amount: "2000000000" }, gas: "1", deposit: "1" } }],
    }, network: "mainnet" }, live({
      accountActivity: async () => [usdtOut(100, 1), usdtOut(100, 2), usdtOut(100, 3)],
      ftBalance: async () => "9000000000",
      ftMetadata: async () => ({ name: "Tether", symbol: "USDT", decimals: 6 }),
    }), { drainerTimeoutMs: 2000 });
    expect(r.findings.find((f) => f.code === "UNUSUAL_AMOUNT")).toMatchObject({ rule: "R19", status: "ATTENTION" });
    expect(r.preview).toContain("You send 2,000 USDT to bob.near.");
  });

  it("sending to a known exchange says so and does not call it a collector", async () => {
    const r = await checkTransaction({ request: {
      signerId: me, receiverId: "binancecold3.near",
      actions: [{ type: "Transfer", params: { deposit: (2n * 10n ** 24n).toString() } }],
    }, network: "mainnet" }, live({ accountActivity: async () => collectorMoves() }), { drainerTimeoutMs: 2000 });
    expect(r.findings.find((f) => f.code === "KNOWN_EXCHANGE")?.title).toMatch(/Known exchange/);
    expect(r.findings.some((f) => f.code === "COLLECTOR_PATTERN")).toBe(false);
  });
});
