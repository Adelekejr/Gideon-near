import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { check, VERDICT_TEXT } from "@gideon/core";
import { acct, empty } from "../../../packages/core/test/helpers.js";
import { CASES, exampleCheckNetwork, inputFromQuery } from "../src/run.js";
import { verdictChrome } from "../src/verdict-text.js";

const at = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const live = empty({ viewAccount: async () => acct(5) });

describe("pending drained-wallet verdict", () => {
  it("does not present a final clear result while the secondary scan is pending", async () => {
    const r = await check({ to: "bob.testnet", network: "testnet", from: "me.testnet", destination: "wallet" }, live);
    expect(r.verdict).toBe("SAFE");
    const pending = verdictChrome(r, true);
    expect(pending.provisional).toBe(true);
    expect(pending.chip).toBe(VERDICT_TEXT.stillCheckingChip);
    expect(pending.chip).not.toBe(VERDICT_TEXT.safeChip);
    expect(pending.label).not.toBe("ALL CLEAR");
    expect(pending.tone).not.toBe("safe");
    expect(pending.why).toBe(VERDICT_TEXT.stillCheckingBody);
    expect(pending.why.toLowerCase()).toContain("not a final");

    const done = verdictChrome(r, false);
    expect(done.provisional).toBe(false);
    expect(done.chip).toBe(VERDICT_TEXT.safeChip);
    expect(done.label).toBe("ALL CLEAR");
    expect(done.tone).toBe("safe");
  });

  it("the checker and send page use that provisional verdict and keep the send lock", () => {
    const checkSrc = at("../src/check.ts");
    const sendSrc = at("../src/send.ts");
    expect(checkSrc).toContain("verdictChrome(r, !!o.pending)");
    expect(checkSrc).toContain("view.provisional");
    expect(sendSrc).toContain("verdictChrome(r, pendingSafe)");
    expect(sendSrc).toContain("sendEnabled(g.canSend, drainerPending)");
    expect(sendSrc).not.toContain("g.canSend && !drainerPending");
  });
});

describe("example network and the visible selector", () => {
  it("a fixed-network example is checked on that network, not the selector's previous choice", () => {
    const mainnetExample = CASES.find((c) => c.id === "intents-wrong-token");
    expect(mainnetExample?.input.network).toBe("mainnet");
    const q = new URLSearchParams("example=intents-wrong-token");
    const { input } = inputFromQuery(q, "testnet");
    expect(input.network).toBe("mainnet");
    expect(exampleCheckNetwork("intents-wrong-token")).toBe("mainnet");
    expect(exampleCheckNetwork("lookalike")).toBe("testnet");
    expect(exampleCheckNetwork("safe")).toBe("testnet");
    expect(exampleCheckNetwork(null)).toBeNull();
    expect(exampleCheckNetwork("missing")).toBeNull();
    for (const c of CASES) {
      const built = inputFromQuery(new URLSearchParams(`example=${c.id}`), c.input.network === "mainnet" ? "testnet" : "mainnet");
      expect(built.input.network).toBe(c.input.network);
      expect(exampleCheckNetwork(c.id)).toBe(c.input.network);
    }
  });

  it("the checker and the homepage move the selector to the example network", () => {
    const checkSrc = at("../src/check.ts");
    const homeSrc = at("../src/home.ts");
    expect(checkSrc).toContain("exampleCheckNetwork");
    expect(checkSrc).toContain("setNetwork(exampleNet)");
    expect(homeSrc).toContain("exampleCheckNetwork");
    expect(homeSrc).toContain("paintNetwork");
    expect(homeSrc).toContain("setNetwork(net)");
  });
});

describe("docs note", () => {
  it("says an invalid supplied amount is flagged and a pending scan is not a final clear", () => {
    const html = at("../docs.html");
    expect(html).toContain("still checking");
    expect(html).toContain("not a final");
    expect(html).toContain("positive decimal");
    expect(html).toContain("Leaving the amount out still checks the address only");
  });
});
