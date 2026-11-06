import { describe, expect, it } from "vitest";
import { gate, nearToYocto, sendEnabled, sendKey, sendNetwork, type GateInput } from "../src/sendgate";

const key = sendKey("testnet", "me.testnet", "bob.testnet", "1");
const base: GateInput = { account: "me.testnet", key, amountOk: true, to: "bob.testnet", checking: false, checked: null, confirmed: false, sending: false, sentKey: null };
const g = (o: Partial<GateInput>) => gate({ ...base, ...o });

describe("send gate", () => {
  it("needs a wallet, then a recipient and amount, then a check", () => {
    expect(g({ account: null }).kind).toBe("connect");
    expect(g({ to: " " }).kind).toBe("fill");
    expect(g({ amountOk: false }).kind).toBe("fill");
    expect(g({})).toMatchObject({ kind: "check", canSend: false, canCheck: true });
    expect(g({ checking: true })).toMatchObject({ kind: "checking", canSend: false, canCheck: false });
  });
  it("SAFE enables send", () => {
    expect(g({ checked: { key, verdict: "SAFE" } })).toMatchObject({ kind: "safe", canSend: true, showConfirm: false });
  });
  it("signing stays locked while the drained-wallet check is pending", () => {
    const canSend = g({ checked: { key, verdict: "SAFE" } }).canSend;
    expect(canSend).toBe(true);
    expect(sendEnabled(canSend, true)).toBe(false);
    expect(sendEnabled(canSend, false)).toBe(true);
    expect(sendEnabled(false, false)).toBe(false);
  });
  it("ATTENTION needs an explicit confirm", () => {
    expect(g({ checked: { key, verdict: "ATTENTION" } })).toMatchObject({ kind: "attention", canSend: false, showConfirm: true });
    expect(g({ checked: { key, verdict: "ATTENTION" }, confirmed: true })).toMatchObject({ canSend: true });
  });
  it("BLOCKED disables send, even if confirmed", () => {
    expect(g({ checked: { key, verdict: "BLOCKED" }, confirmed: true })).toMatchObject({ kind: "blocked", canSend: false, showConfirm: false });
  });
  it("any edit invalidates the check", () => {
    const old = { key: sendKey("testnet", "me.testnet", "bob.testnet", "0.5"), verdict: "SAFE" as const };
    expect(g({ checked: old })).toMatchObject({ kind: "check", canSend: false });
    const otherWallet = { key: sendKey("testnet", "other.testnet", "bob.testnet", "1"), verdict: "SAFE" as const };
    expect(g({ checked: otherWallet }).canSend).toBe(false);
    expect(sendKey("testnet", "a", " b ", "1 ")).toBe(sendKey("testnet", "a", "b", "1"));
  });
  it("no double send while signing or after it went out", () => {
    expect(g({ checked: { key, verdict: "SAFE" }, sending: true }).canSend).toBe(false);
    expect(g({ checked: { key, verdict: "SAFE" }, sentKey: key })).toMatchObject({ kind: "sent", canSend: false });
  });
});

describe("amount and network", () => {
  it("converts NEAR to yocto exactly", () => {
    expect(nearToYocto("1")).toBe("1000000000000000000000000");
    expect(nearToYocto("0.25")).toBe("250000000000000000000000");
    expect(nearToYocto(" 0.000000000000000000000001 ")).toBe("1");
    expect(nearToYocto("12345.6789")).toBe("12345678900000000000000000000");
  });
  it("rejects bad amounts", () => {
    for (const bad of ["", "0", "0.0", "-1", "1e3", "1,5", "abc", "1." , "0." + "0".repeat(24) + "1"]) expect(() => nearToYocto(bad)).toThrow();
  });
  it("network comes from config, testnet by default", () => {
    expect(sendNetwork(undefined)).toBe("testnet");
    expect(sendNetwork("mainnet")).toBe("mainnet");
    expect(() => sendNetwork("devnet")).toThrow();
  });
});
