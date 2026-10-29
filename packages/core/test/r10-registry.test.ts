import { describe, expect, it } from "vitest";
import { check } from "../src/engine.js";
import { NETWORKS } from "../src/networks.js";
import { NOW, acct, empty, find } from "./helpers.js";

const REG = "flags.hammed-stampdue.testnet";
const to = "scam-payroll.testnet";
const live = (over: Parameters<typeof empty>[0] = {}) => empty({ viewAccount: async () => acct(1), ...over });
const run = (s: ReturnType<typeof empty>, flagRegistry: string | undefined = REG) =>
  check({ network: "testnet", to }, s, { now: NOW, ...(flagRegistry === undefined ? {} : { flagRegistry }) });

describe("R10 community flag registry", () => {
  it("no registry configured → skipped (default until the contract is deployed)", async () => {
    expect(NETWORKS.testnet.flagRegistry).toBeNull();
    const r = await check({ network: "testnet", to }, live(), { now: NOW });
    expect(find(r, "R10")[0].status).toBe("SKIPPED");
    expect(r.verdict).toBe("SAFE");
  });
  it("no flags → PASS, view call asks the right contract for the right account", async () => {
    const asked: string[][] = [];
    const r = await run(live({ communityFlags: async (n, reg, a) => { asked.push([n, reg, a]); return []; } }));
    expect(asked).toEqual([["testnet", REG, to]]);
    expect(find(r, "R10")[0].code).toBe("NO_FLAGS");
    expect(r.verdict).toBe("SAFE");
  });
  it("flagged → ATTENTION (never BLOCKED: anyone can flag), with reasons as evidence", async () => {
    const r = await run(live({ communityFlags: async () => [
      { reporter: "alice.testnet", reason: "sent me dust", at_ms: 1 },
      { reporter: "bob.testnet", reason: "poisoning", at_ms: 2 }] }));
    const x = find(r, "R10")[0];
    expect([x.status, x.code, x.title]).toEqual(["ATTENTION", "COMMUNITY_FLAGGED", "Flagged by 2 people"]);
    expect(x.evidence?.map((e) => e.value)).toContain("sent me dust");
    expect(r.verdict).toBe("ATTENTION");
  });
  it("registry contract missing → couldn't check, never safe", async () => {
    const r = await run(live({ communityFlags: async () => null }));
    const x = find(r, "R10")[0];
    expect([x.status, x.code]).toEqual(["COULD_NOT_CHECK", "REGISTRY_MISSING"]);
    expect(x.title).toMatch(/Couldn't check/);
    expect(r.verdict).toBe("ATTENTION");
  });
  it("RPC down → couldn't check", async () => {
    const r = await run(live({ communityFlags: async () => { throw new Error("timeout"); } }));
    expect(find(r, "R10")[0].status).toBe("COULD_NOT_CHECK");
    expect(r.verdict).toBe("ATTENTION");
  });
  it("empty string turns R10 off; non-NEAR address is skipped", async () => {
    expect(find(await run(live(), ""), "R10")[0].status).toBe("SKIPPED");
    const r = await check({ network: "testnet", to: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq" }, live(), { now: NOW, flagRegistry: REG });
    expect(find(r, "R10")[0].status).toBe("SKIPPED");
  });
});
