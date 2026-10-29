import { describe, expect, it } from "vitest";
import { lookalike, sharedEnds, skeleton } from "../src/similarity.js";

const yes = (a: string, b: string) => expect(lookalike(a, b), `${a} vs ${b}`).toBeTruthy();
const no = (a: string, b: string) => expect(lookalike(a, b), `${a} vs ${b}`).toBeNull();

describe("named lookalikes", () => {
  it("an extra or missing character", () => {
    yes("adelekejr1.near", "adelekejr.near");
    yes("adelekej.near", "adelekejr.near");
    yes("adelekejrr.near", "adelekejr.near");
    yes("bob1.near", "bob.near"); // short name, digits added at the end
    yes("bob_.near", "bob.near");
  });
  it("1/l, 0/o and i/l swaps", () => {
    yes("ade1ekejr.near", "adelekejr.near");
    yes("adeiekejr.near", "adelekejr.near");
    yes("bigbank1o1.near", "bigbank101.near");
    yes("s0cial.near", "social.near");
    yes("payro11.testnet", "payroll.testnet");
  });
  it("hyphen, underscore and dot", () => {
    yes("adele-kejr.near", "adele.kejr.near");
    yes("adele_kejr.near", "adele-kejr.near");
    expect(skeleton("a-b_c.d")).toBe("a.b.c.d");
  });
  it("swapped letters", () => yes("warp.near", "wrap.near"));
  it("different names stay different", () => {
    no("bob.near", "rob.near");
    no("alice.near", "bob.near");
    no("adelekejr.near", "adelekejr.near");
    no("betalife.near", "social.near");
    no("wrap.near", "v2.ref-finance.near");
    no("abc.near", "abd.near"); // short names: only look-alike characters count
  });
});

describe("64-hex lookalikes", () => {
  const real = "9ebef819489ae5e6641cc5573740dadc751c35c3ae37c110e4fad8101494e418";
  /** Keep `head` and `tail` characters of real, change everything in between. */
  const grind = (head: number, tail: number) =>
    real.slice(0, head) + [...real.slice(head, 64 - tail)].map((c) => (c === "0" ? "1" : "0")).join("") + real.slice(64 - tail);
  it("prefix and suffix of different lengths", () => {
    for (const [h, t] of [[4, 4], [3, 3], [2, 4], [4, 2], [6, 0], [0, 6], [8, 8]]) {
      yes(grind(h!, t!), real);
    }
  });
  it("names the matching ends", () => {
    expect(lookalike(grind(3, 3), real)?.reason).toMatch(/^Same first 3 and last 3 characters/);
    expect(lookalike(grind(6, 0), real)?.reason).toMatch(/^Same first 6 characters/);
  });
  it("a few characters changed anywhere (small edit distance)", () => {
    const typo = real.slice(0, 10) + "0" + real.slice(11, 30) + "f" + real.slice(31, 50) + "a" + real.slice(51);
    expect(lookalike(typo, real)?.reason).toBe("Only 3 characters differ");
  });
  it("ends too short to be a grind stay different", () => {
    no(grind(2, 2), real);
    no(grind(5, 0), real);
    no(grind(1, 4), real);
    no(real.slice(0, 63), real);
  });
  it("0x addresses compare after the prefix", () => {
    const a = "0x" + "ab12" + "0".repeat(32) + "cd34", b = "0x" + "ab12" + "f".repeat(32) + "cd34";
    yes(a, b);
    expect(sharedEnds("abcxyz", "abqxyz")).toEqual({ head: 2, tail: 3 });
  });
});
