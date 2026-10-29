import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

let run: typeof import("../src/run");
beforeAll(async () => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  run = await import("../src/run");
});

describe("website: Sending from", () => {
  it("the check form has an optional Sending from field, in the existing input style", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    expect(html).toMatch(/<label class="label" for="from">Sending from \(optional[^<]*<\/label><input class="input" id="from" name="from"/);
    expect(html).not.toMatch(/id="from"[^>]*required/);
  });
  it("?from= reaches the check input", () => {
    const { input } = run.inputFromQuery(new URLSearchParams("to=bob.testnet&from=me.testnet"), "testnet");
    expect(input.from).toBe("me.testnet");
    expect(run.inputFromQuery(new URLSearchParams("to=bob.testnet"), "testnet").input.from).toBeUndefined();
  });
  it("history lookups have their own short limit (never hold the verdict)", () => {
    expect(run.HISTORY_MS).toBeLessThanOrEqual(3000);
  });
  it("a recorded (offline) check with a sender still answers, with no history and no first-send note", async () => {
    const r = await run.runCheck({ to: "alice.testnet", network: "testnet", from: "me.testnet", asset: { symbol: "NEAR" }, destination: "unknown" }, true);
    expect(r.findings.find((f) => f.rule === "R7")?.code).toBe("HISTORY_UNAVAILABLE");
    expect(r.findings.find((f) => f.rule === "R13")?.status).not.toBe("ATTENTION");
  });
});
