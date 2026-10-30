import { describe, expect, it } from "vitest";
import { twinName } from "../src/rules/r16-other-network.js";
import { acct, empty, find, run } from "./helpers.js";
import type { Network } from "../src/types.js";

/** Accounts that exist, per network. */
const chain = (live: Partial<Record<Network, string[]>>) =>
  empty({ viewAccount: async (n: Network, id: string) => ((live[n] ?? []).includes(id) ? acct(3) : null) });

describe("twinName", () => {
  it("swaps the network ending", () => {
    expect(twinName("alice.near")).toEqual({ twin: "alice.testnet", home: "mainnet" });
    expect(twinName("pay.alice.testnet")).toEqual({ twin: "pay.alice.near", home: "testnet" });
    expect(twinName("near")).toBeNull();
    expect(twinName("alice.tg")).toBeNull();
  });
});

describe("R16 same name on the other network", () => {
  it("certain testnet, typed name.near, name.testnet exists → BLOCKED with the twin", async () => {
    const r = await run({ to: "alice-wallet.near", network: "testnet" }, chain({ testnet: ["alice-wallet.testnet"] }));
    expect(r.verdict).toBe("BLOCKED");
    expect(r.headline?.code).toBe("OTHER_NETWORK_TWIN");
    expect(r.headline?.title).toBe("Wrong network: did you mean alice-wallet.testnet?");
    expect(find(r, "R1")[0].code).toBe("NETWORK_MISMATCH");
  });
  it("certain mainnet, typed name.testnet, name.near exists → BLOCKED with the twin", async () => {
    const r = await run({ to: "alice-wallet.testnet", network: "mainnet" }, chain({ mainnet: ["alice-wallet.near"] }));
    expect(r.headline?.code).toBe("OTHER_NETWORK_TWIN");
    expect(r.headline?.detail).toContain("alice-wallet.near exists on");
  });
  it("no twin → R1's mismatch block leads, R16 just notes it", async () => {
    const r = await run({ to: "alice-wallet.near", network: "testnet" }, chain({}));
    expect(r.headline?.code).toBe("NETWORK_MISMATCH");
    expect(find(r, "R16")[0].code).toBe("NO_TWIN");
  });
  it("wallet only seems to be on testnet → ATTENTION hint, never a block", async () => {
    const r = await run({ to: "alice-wallet.near", network: "mainnet", walletNetwork: "testnet" },
      chain({ mainnet: ["alice-wallet.near"], testnet: ["alice-wallet.testnet"] }));
    const x = find(r, "R16")[0];
    expect(x.status).toBe("ATTENTION");
    expect(x.code).toBe("MAYBE_OTHER_NETWORK");
    expect(x.title).toBe("Your wallet may be on testnet");
    expect(r.verdict).not.toBe("BLOCKED");
  });
  it("wallet hint with no twin → no hint", async () => {
    const r = await run({ to: "alice-wallet.near", network: "mainnet", walletNetwork: "testnet" }, chain({ mainnet: ["alice-wallet.near"] }));
    expect(find(r, "R16")[0].status).toBe("PASS");
  });
  it("name matches the network and no wallet hint → skipped, no extra lookup", async () => {
    const seen: string[] = [];
    const r = await run({ to: "alice-wallet.testnet", network: "testnet" },
      empty({ viewAccount: async (n, id) => { seen.push(`${n}:${id}`); return acct(3); } }));
    expect(find(r, "R16")[0].status).toBe("SKIPPED");
    expect(seen.some((s) => s.includes(".near"))).toBe(false);
  });
  it("twin lookup fails → info only, verdict unchanged by R16", async () => {
    const r = await run({ to: "alice-wallet.near", network: "mainnet", walletNetwork: "testnet" },
      empty({ viewAccount: async (n) => { if (n === "testnet") throw new Error("rpc down"); return acct(3); } }));
    expect(find(r, "R16")[0].code).toBe("TWIN_UNKNOWN");
    expect(find(r, "R16")[0].status).toBe("PASS");
  });
});
