import { describe, expect, it } from "vitest";
import { acct, empty, find, run } from "./helpers.js";

/** Explorers show a page for any name, so a link would make a missing account look real. */
const links = (r: Awaited<ReturnType<typeof run>>) => r.findings.flatMap((f) => (f.evidence ?? []).filter((e) => e.url).map((e) => `${f.rule} ${e.label} ${e.url}`));

describe("no explorer links to accounts that don't exist", () => {
  it("missing named account (iliar.near): BLOCKED, account and close matches shown as plain text", async () => {
    const r = await run({ to: "iliar.near", network: "mainnet", addressBook: [{ account: "illia.near" }] },
      empty({ viewAccount: async (_n, a) => (a === "illia.near" ? acct(5) : null) }));
    const r3 = find(r, "R3")[0]!;
    expect(r3.code).toBe("ACCOUNT_NOT_FOUND");
    expect(r3.evidence?.[0]).toEqual({ label: "Account", value: "iliar.near" });
    expect(r3.evidence?.some((e) => e.url)).toBe(false);
    expect(r.headline?.evidence?.some((e) => e.url)).toBe(false);
    expect(links(r).filter((l) => /nearblocks\.io\/address/.test(l))).toEqual([]);
  });

  it("unused 64-hex and 0x accounts aren't linked; existing ones are", async () => {
    const hex = "a".repeat(64);
    expect(links(await run({ to: hex }, empty()))).toEqual([]);
    expect(links(await run({ to: "0x" + "b".repeat(40) }, empty()))).toEqual([]);
    const ok = await run({ to: "alice.testnet" }, empty({ viewAccount: async () => acct(5) }));
    expect(find(ok, "R3")[0]!.evidence?.[0].url).toMatch(/^https:\/\/testnet\.nearblocks\.io\/address\/alice\.testnet/);
  });

  it("a token contract that isn't a token isn't linked", async () => {
    const r = await run({ to: "alice.testnet", asset: { kind: "ft", contract: "nope.testnet" } }, empty({ viewAccount: async () => acct(5) }));
    const r5 = find(r, "R5")[0]!;
    expect(r5.code).toBe("NOT_A_TOKEN");
    expect(r5.evidence?.some((e) => e.url)).toBe(false);
  });
});
