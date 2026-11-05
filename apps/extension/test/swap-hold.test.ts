// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

/*
 * A page script can change the recipient after a check, or replace the Send button.
 * happy-dom events are not trusted unless the test forces isTrusted.
 */
const attach = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (o: ShadowRootInit) { return attach.call(this, { ...o, mode: "open" }); };

const blocked = {
  ok: true,
  result: {
    engine: "t", verdict: "BLOCKED", headline: { rule: "R3", status: "BLOCKED", code: "ACCOUNT_NOT_FOUND", title: "Missing", detail: "Missing." },
    findings: [{ rule: "R3", status: "BLOCKED", code: "ACCOUNT_NOT_FOUND", title: "Missing", detail: "Missing." }],
    classification: { kind: "near-named", normalized: "nobody.testnet" },
    input: { to: "nobody.testnet", network: "testnet", asset: { symbol: "NEAR" }, destination: "unknown" },
    account: { exists: false }, sources: [], checkedAt: "2026-11-05T00:00:00Z", ms: 1,
    receipt: { sha256: "ab" },
  },
  net: { network: "testnet", why: "test" },
};
let answer: unknown = blocked;
const sent: { type?: string }[] = [];
vi.stubGlobal("chrome", {
  runtime: {
    id: "test", getURL: (p: string) => `chrome-extension://test/${p}`,
    sendMessage: async (m: { type?: string }) => { sent.push(m); return answer; },
  },
  storage: { local: { get: async () => ({}), set: async () => undefined }, onChanged: { addListener: () => undefined } },
});
await import("../src/content.js");

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
function trusted(type: string, extra: EventInit = {}): Event {
  const ev = new Event(type, { bubbles: true, ...extra });
  Object.defineProperty(ev, "isTrusted", { get: () => true });
  return ev;
}
const card = () => (document.querySelector("gideon-watch")?.shadowRoot?.textContent ?? "").replace(/\s+/g, " ");

describe("silent recipient swap and a replaced Send button", () => {
  it("re-checks a swapped recipient and holds a button the page just rendered", async () => {
    document.body.innerHTML = `<form><input id="to" name="recipient" placeholder="Recipient"><button type="submit">Send</button></form>`;
    const input = document.querySelector("input") as HTMLInputElement;
    input.value = "nobody.testnet";
    input.dispatchEvent(trusted("input"));
    for (let i = 0; i < 40 && !card().includes("Missing"); i++) await wait(50);
    expect(card()).toContain("Missing");
    const checks = () => sent.filter((m) => m.type === "gideon:check").length;
    const before = checks();
    expect((document.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
    input.value = "other.testnet";
    for (let i = 0; i < 20 && checks() === before; i++) await wait(50);
    expect(checks()).toBeGreaterThan(before);
    const form = document.querySelector("form")!;
    form.querySelector("button")!.remove();
    const neu = document.createElement("button");
    neu.type = "submit";
    neu.textContent = "Send";
    form.appendChild(neu);
    const fake = document.createElement("div");
    fake.setAttribute("role", "button");
    fake.textContent = "Send";
    form.appendChild(fake);
    await wait(30);
    expect(neu.disabled).toBe(true);
    expect(fake.getAttribute("aria-disabled")).toBe("true");
    const ev = trusted("click", { cancelable: true });
    fake.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});
