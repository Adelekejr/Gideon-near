import { describe, expect, it } from "vitest";
import { check, VERDICT_TEXT, withDrainer, drainerFailedFinding } from "@gideon/core";
import { acct, empty } from "../../../packages/core/test/helpers.js";
import { chipOf, countsLine, HOME_CHIP, notChecked, safeTitle, safeWhy, sendersLine } from "../src/verdict-text";

const live = empty({ viewAccount: async () => acct(5) });

describe("fix 5: website wording", () => {
  it("SAFE: NO PROBLEMS FOUND, the approved body, no 'Looks right' / 'SAFE TO SEND'", async () => {
    const r = await check({ to: "bob.testnet", network: "testnet", from: "me.testnet", destination: "wallet" }, live);
    expect(r.verdict).toBe("SAFE");
    expect(chipOf(r)).toBe("NO PROBLEMS FOUND");
    expect(safeWhy()).toBe(VERDICT_TEXT.safeBody);
    expect(safeTitle(r)).not.toMatch(/looks right/i);
    expect(HOME_CHIP.SAFE).toBe("No problems found");
  });
  it("unknown sender: the 'Not checked' line shows and is counted as not checked", async () => {
    const r = await check({ to: "bob.testnet", network: "testnet", destination: "wallet" }, live);
    expect(notChecked(r)).toEqual([VERDICT_TEXT.senderUnknown]);
    expect(countsLine(r)).toMatch(/ · 1 not checked · /);
  });
});

describe("fix 7: a failed drained-wallet check (R18) says couldn't check", () => {
  it("FAILED, or no answer at all, shows the line; a pass shows its own title", async () => {
    const r = await check({ to: "bob.testnet", network: "testnet", from: "me.testnet", destination: "wallet" }, live);
    const failed = await withDrainer(r, drainerFailedFinding());
    expect(failed.verdict).toBe("ATTENTION");
    expect(sendersLine(failed)).toBe(`Senders: ${VERDICT_TEXT.drainerFailed}`);
    expect(sendersLine(r, { noAnswer: true })).toBe(`Senders: ${VERDICT_TEXT.drainerFailed}`);
    expect(countsLine(failed)).toMatch(/1 not checked/);
    expect(sendersLine(r, { pending: true })).toMatch(/Checking recent senders/);
  });
});
