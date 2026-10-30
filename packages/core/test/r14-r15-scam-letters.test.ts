import { describe, expect, it } from "vitest";
import { REPORTED_SCAMS } from "../src/reported-scams.js";
import { oddCharacters, plainVersion } from "../src/rules/r15-fake-letters.js";
import { acct, empty, find, run } from "./helpers.js";

const live = empty({ viewAccount: async () => acct(1) });

describe("R14 reported scam", () => {
  it("every entry has a report link, a quote and a check date", () => {
    for (const s of REPORTED_SCAMS) {
      expect(s.url).toMatch(/^https:\/\//);
      expect(s.quote.length).toBeGreaterThan(10);
      expect(s.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.account).toBe(s.account.toLowerCase());
    }
  });
  it.each(REPORTED_SCAMS.map((s) => [s.account, s.url]))("%s → BLOCKED Reported scam, linking %s", async (account, url) => {
    const r = await run({ to: account, network: "mainnet" }, live);
    expect(r.verdict).toBe("BLOCKED");
    expect(r.headline?.rule).toBe("R14");
    expect(r.headline?.title).toBe("Reported scam");
    expect(r.headline?.evidence?.[0]?.url).toBe(url);
  });
  it("reported even when the account looks brand-new or was sent to before", async () => {
    const r = await run({ to: "bigbank101.near", network: "mainnet", from: "me.near" }, empty({
      viewAccount: async () => acct(1),
      recentTransfers: async () => [{ hash: "t", signer: "me.near", receiver: "bigbank101.near", depositYocto: 1e24 }],
    }));
    expect(r.headline?.code).toBe("REPORTED_SCAM");
  });
  it("only on its own network; other accounts pass", async () => {
    expect(find(await run({ to: "bigbank101.testnet" }, live), "R14")[0].code).toBe("NOT_REPORTED");
    expect(find(await run({ to: "alice.near", network: "mainnet" }, live), "R14")[0].status).toBe("PASS");
  });
});

describe("R15 fake letters and hidden characters", () => {
  it("Greek alpha → BLOCKED, naming the letter", async () => {
    const r = await run({ to: "ref-finαnce.testnet" }, live);
    expect(r.verdict).toBe("BLOCKED");
    expect(r.headline?.rule).toBe("R15");
    expect(r.headline?.title).toBe("Fake letter: contains a Greek 'α' that looks like 'a'");
    expect(r.headline?.fix?.join(" ")).toContain("ref-finance.testnet");
  });
  it("Cyrillic о → BLOCKED", async () => {
    const r = await run({ to: "b\u043Eb.near", network: "mainnet" }, live);
    expect(r.headline?.title).toBe("Fake letter: contains a Cyrillic 'о' that looks like 'o'");
  });
  it("zero-width space inside → BLOCKED", async () => {
    const r = await run({ to: "ref\u200B-finance.testnet" }, live);
    expect(r.headline?.code).toBe("INVISIBLE_CHARACTER");
    expect(r.headline?.title).toContain("zero-width space");
  });
  it("U+FEFF and a non-breaking space at the end aren't trimmed away", async () => {
    expect((await run({ to: "\uFEFFalice.testnet" }, live)).headline?.code).toBe("INVISIBLE_CHARACTER");
    const r = await run({ to: "alice.testnet\u00A0" }, live);
    expect(r.headline?.code).toBe("HIDDEN_SPACE");
    expect(r.headline?.title).toContain("non-breaking space");
  });
  it("space inside → BLOCKED; ordinary spaces at the ends are fine", async () => {
    expect((await run({ to: "alice .testnet" }, live)).headline?.code).toBe("HIDDEN_SPACE");
    const ok = await run({ to: "  alice.testnet \n" }, live);
    expect(find(ok, "R15")[0].status).toBe("PASS");
  });
  it("full-width letters and other scripts", () => {
    expect(oddCharacters("ａlice.near")[0]!.what).toBe("a full-width 'ａ' that looks like 'a'");
    expect(oddCharacters("al→ice.near")[0]!.kind).toBe("other");
    expect(plainVersion("bigbаnk101.near")).toBe("bigbank101.near");
    expect(oddCharacters("alice.testnet")).toEqual([]);
  });
  it("fake letter beats the plain format error in the headline", async () => {
    const r = await run({ to: "αlice.testnet" }, live);
    expect(find(r, "R1")[0].status).toBe("BLOCKED");
    expect(r.headline?.rule).toBe("R15");
  });
});

describe("R7 / R13 with sends from this device", () => {
  it("lookalike of a device send → BLOCKED even with no sender", async () => {
    const r = await run({ to: "ref-flnance.testnet", deviceSends: ["ref-finance.testnet"] }, empty());
    expect(r.headline?.code).toBe("LOOKALIKE_OF_PAST_RECIPIENT");
    expect(r.headline?.title).toBe("Looks like ref-finance.testnet, but it isn't");
    expect(r.headline?.detail).toContain("from this device");
    // It doesn't exist either, but the lookalike leads.
    expect(find(r, "R3")[0].status).toBe("BLOCKED");
    expect(r.headline?.detail).toContain("doesn't exist");
  });
  it("the device send itself → SENT_BEFORE", async () => {
    const r = await run({ to: "ref-finance.testnet", from: "me.testnet", deviceSends: ["ref-finance.testnet"] }, live);
    expect(find(r, "R13")[0].code).toBe("SENT_BEFORE");
    expect(find(r, "R7")[0].status).toBe("PASS");
  });
  it("lookalike of a past recipient leads over 'doesn't exist' (history)", async () => {
    const r = await run({ to: "ref-flnance.testnet", from: "hammed-stampdue.testnet" }, empty({
      recentTransfers: async () => [{ hash: "EyYC", signer: "hammed-stampdue.testnet", receiver: "ref-finance.testnet", depositYocto: 1e23 }],
    }));
    expect(r.headline?.code).toBe("LOOKALIKE_OF_PAST_RECIPIENT");
    expect(find(r, "R3")[0].status).toBe("BLOCKED");
  });
});
