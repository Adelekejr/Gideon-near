import { describe, expect, it } from "vitest";
import type { AccountInfo } from "../src/types.js";
import { acct, empty, fake, find, run } from "./helpers.js";

/**
 * The rule Hammed asked for: a recipient is SAFE only after a live lookup on the
 * selected network found the account. Not found → BLOCKED (named) or ATTENTION
 * (implicit). Lookup failed → couldn't check. Never SAFE by default.
 */
describe("account existence (live view_account on the selected network)", () => {
  it("nonexistent named testnet account → BLOCKED, with spelling fix", async () => {
    const r = await run({ to: "adelekejr-nope.testnet" }, empty());
    expect(r.verdict).toBe("BLOCKED");
    expect(r.headline?.code).toBe("ACCOUNT_NOT_FOUND");
    expect(r.headline?.title).toBe("This account doesn't exist on NEAR testnet");
    expect(r.headline?.detail).toMatch(/fails and comes back, minus the network fee/);
    expect(r.headline?.fix?.[0]).toMatch(/spelling/);
    expect(r.account).toMatchObject({ id: "adelekejr-nope.testnet", network: "testnet", exists: false });
  });

  it("nonexistent named mainnet account → BLOCKED", async () => {
    const r = await run({ to: "adelekejr-nope.near", network: "mainnet" }, empty());
    expect(r.verdict).toBe("BLOCKED");
    expect(r.headline?.title).toBe("This account doesn't exist on NEAR mainnet");
  });

  it("nonexistent sub-account → BLOCKED", async () => {
    const r = await run({ to: "pay.adelekejr-nope.testnet" }, empty());
    expect(r.headline?.code).toBe("ACCOUNT_NOT_FOUND");
  });

  it("looks up the account on the network you picked, not another one", async () => {
    const asked: string[] = [];
    const s = empty({ viewAccount: async (n, id) => { asked.push(`${n}:${id}`); return n === "mainnet" ? acct(3) : null; } });
    const r = await run({ to: "both.near", network: "mainnet" }, s);
    expect(asked).toEqual(["mainnet:both.near"]);
    expect(r.verdict).toBe("SAFE");
  });

  it("suggests close matches from the address book", async () => {
    const r = await run({ to: "adelekejrr.testnet", addressBook: [{ account: "adelekejr.testnet", label: "Me" }] }, empty());
    expect(r.verdict).toBe("BLOCKED");
    const nf = find(r, "R3")[0];
    expect(nf.code).toBe("ACCOUNT_NOT_FOUND");
    expect(nf.fix?.join(" ")).toMatch(/Did you mean adelekejr\.testnet\?/);
    // The lookalike headline also says the pasted account doesn't exist.
    expect(r.headline?.detail).toMatch(/doesn't exist on NEAR testnet/);
  });

  it("existing account → SAFE, with existence, balance and creation date in the result", async () => {
    const r = await run({ to: "hammed-stampdue.testnet" },
      empty({ viewAccount: async () => acct(10), accountCreated: async () => Date.parse("2022-04-30T06:52:09Z") }));
    expect(r.verdict).toBe("SAFE");
    expect(r.account).toMatchObject({ exists: true, balanceNear: "10", contract: false });
    expect(r.account?.createdAt).toBe("2022-04-30T06:52:09.000Z");
    expect(r.account?.summary).toBe("Account exists on NEAR testnet. Created 30 Apr 2022. Holds 10 NEAR.");
    const p = find(r, "R3")[0];
    expect(p).toMatchObject({ status: "PASS", code: "ACCOUNT_EXISTS", title: "Account exists on NEAR testnet" });
  });

  it("a failed creation-date lookup is LOOK AGAIN, never SAFE", async () => {
    const r = await run({ to: "bob.testnet" },
      empty({ viewAccount: async () => acct(1), accountCreated: async () => { throw new Error("rate limited"); } }));
    expect(r.verdict).toBe("ATTENTION");
    expect(r.account?.createdAt).toBeUndefined();
    expect(r.sources.find((s) => s.source.startsWith("nearblocks"))).toMatchObject({ ok: false, optional: true });
  });

  it("RPC failure → couldn't check (ATTENTION), never SAFE", async () => {
    for (const to of ["bob.testnet", "c".repeat(64), "0x94a0abA1283aF69Cb260b7e0Ea0366Dca0dd3cd8"]) {
      const r = await run({ to }, fake());
      expect(r.verdict, to).toBe("ATTENTION");
      expect(r.headline?.status, to).toBe("COULD_NOT_CHECK");
      expect(r.account?.exists, to).toBeNull();
    }
  });

  it("RPC times out → couldn't check, never SAFE", async () => {
    const r = await run({ to: "bob.testnet" }, empty({ viewAccount: () => Promise.reject(new Error("timeout after 8000ms")) }));
    expect(r.verdict).not.toBe("SAFE");
  });

  it("implicit 64-hex account never used → ATTENTION, OK only if the owner gave it to you", async () => {
    const r = await run({ to: "d".repeat(64) }, empty());
    expect(r.verdict).toBe("ATTENTION");
    expect(r.headline?.code).toBe("IMPLICIT_UNFUNDED");
    expect(r.headline?.detail).toMatch(/only OK if the owner gave it to you/);
    expect(r.account?.exists).toBe(false);
  });

  it("ETH-implicit 0x account never used → ATTENTION; in use → SAFE", async () => {
    const E = "0x94a0abA1283aF69Cb260b7e0Ea0366Dca0dd3cd8";
    expect((await run({ to: E }, empty())).verdict).toBe("ATTENTION");
    const r = await run({ to: E }, empty({ viewAccount: async () => acct(2) }));
    expect(r.verdict).toBe("SAFE");
    expect(r.account?.exists).toBe(true);
  });

  it("invariant: odd data from the RPC can't produce SAFE without a confirmed account", async () => {
    const r = await run({ to: "weird.testnet" }, empty({ viewAccount: async () => ({}) as AccountInfo }));
    expect(r.verdict).not.toBe("SAFE");
  });

  it("every SAFE result carries a confirmed account", async () => {
    const r = await run({ to: "bob.testnet" }, empty({ viewAccount: async () => acct(1) }));
    expect(r.verdict).toBe("SAFE");
    expect(r.account?.exists).toBe(true);
    expect(r.findings.some((f) => f.status === "PASS" && f.code === "ACCOUNT_EXISTS")).toBe(true);
  });
});
