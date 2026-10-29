// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from "vitest";
import { findSendButtons, isRecipientField, isStrongAddress, isTextField, shouldCheck, type Field } from "../src/lib/detect.js";

const TRON_HASH = "89a46298b5f72a95c3205ec6dfc2e842860f1faf24e701de2ae03418f4126944";
const field = (sel: string) => document.querySelector(sel) as Field;

beforeEach(() => {
  document.body.innerHTML = `
  <form id="w">
    <label for="addr">Withdrawal address</label><input id="addr">
    <div><span>Recipient</span><div><input id="rc"></div></div>
    <input id="amt" name="amount" placeholder="Amount">
    <input id="mail" type="email" placeholder="Email address">
    <input id="street" placeholder="Street address">
    <input id="memo" name="memo" placeholder="Memo">
    <input id="pw" type="password">
    <input id="plain">
    <button type="button">Max</button><button type="submit">Withdraw</button>
  </form>
  <div id="loose"><input id="to" aria-label="To"><div role="button">Send</div><button>Cancel</button></div>`;
});

describe("recipient field detection", () => {
  it("finds fields labelled as a recipient", () => {
    expect(isRecipientField(field("#addr"))).toBe(true);
    expect(isRecipientField(field("#rc"))).toBe(true);
    expect(isRecipientField(field("#to"))).toBe(true);
  });
  it("ignores amount, email, street, memo and unlabelled fields", () => {
    for (const s of ["#amt", "#street", "#memo", "#plain"]) expect(isRecipientField(field(s)), s).toBe(false);
    expect(isTextField(field("#mail"))).toBe(false);
    expect(isTextField(field("#pw"))).toBe(false);
  });
});

describe("what gets checked", () => {
  it("strong address shapes are checked anywhere", () => {
    expect(isStrongAddress(TRON_HASH)).toBe(true);
    expect(isStrongAddress("0x94a0abA1283aF69Cb260b7e0Ea0366Dca0dd3cd8")).toBe(true);
    expect(isStrongAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")).toBe(true);
    expect(isStrongAddress("alice.near")).toBe(true);
    expect(isStrongAddress("hello")).toBe(false);
    expect(isStrongAddress("hello world.near")).toBe(false);
    expect(shouldCheck(field("#plain"), TRON_HASH)).toBe(true);
  });
  it("plain words only in recipient fields", () => {
    expect(shouldCheck(field("#plain"), "bob")).toBe(false);
    expect(shouldCheck(field("#addr"), "bob")).toBe(true);
    expect(shouldCheck(field("#addr"), "")).toBe(false);
    expect(shouldCheck(field("#addr"), "two words")).toBe(false);
  });
});

describe("send buttons to hold", () => {
  it("in a form: the submit / Withdraw button, not Max", () => {
    const b = findSendButtons(field("#addr")).map((x) => x.textContent);
    expect(b).toEqual(["Withdraw"]);
  });
  it("without a form: the nearby Send button, not Cancel", () => {
    const b = findSendButtons(field("#to")).map((x) => x.textContent);
    expect(b).toEqual(["Send"]);
  });
});
