// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { check } from "@gideon/core";
import { collectSignals, decide, fromTexts, fromUrl, pageHint, recipientScope, type NetHint } from "../src/lib/network.js";
import { resolveNetwork } from "../src/lib/resolve.js";
import { findSendButtons, isRecipientField, type Field } from "../src/lib/detect.js";
import { card } from "../src/lib/view.js";
import { placement } from "../src/lib/place.js";
import { empty } from "../../../packages/core/test/helpers.js";

const METEOR = readFileSync(join(__dirname, "../test-page/meteor-send.html"), "utf8");

/** Load the Meteor reconstruction; `top` marks its top bar as laid out at the top of the screen, like a real browser. */
function meteor(opts: { account?: string; menu?: boolean; layout?: boolean } = {}): Field {
  document.documentElement.innerHTML = METEOR.replace(/<script>[\s\S]*?<\/script>/, "").replace(/^[\s\S]*?<html[^>]*>/, "").replace(/<\/html>[\s\S]*$/, "");
  if (opts.account !== undefined) document.getElementById("acc")!.textContent = opts.account;
  if (opts.menu) document.getElementById("drop")!.classList.add("open");
  if (opts.layout !== false) {
    const bar = document.querySelector(".css-k008qs")!;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const inBar = bar.contains(this);
      return { top: inBar ? 14 : 400, bottom: inBar ? 40 : 446, left: 16, right: 300, width: 284, height: 26, x: 16, y: inBar ? 14 : 400, toJSON() {} } as DOMRect;
    });
  }
  return document.getElementById("to") as Field;
}

const sure = (h: NetHint) => [h.network, h.source, h.sure];

beforeEach(() => vi.restoreAllMocks());

describe("network from the page address", () => {
  it("knows wallets that use one host per network", () => {
    expect(sure(fromUrl("https://testnet.mynearwallet.com/send-money")!)).toEqual(["testnet", "url", true]);
    expect(sure(fromUrl("https://app.mynearwallet.com/send-money")!)).toEqual(["mainnet", "url", true]);
    expect(fromUrl("https://testnet.wallet.bitte.ai/send")!.network).toBe("testnet");
    expect(fromUrl("https://wallet.bitte.ai/send")!.network).toBe("mainnet");
    expect(fromUrl("https://testnet.nearblocks.io/address/x.testnet")!.network).toBe("testnet");
    expect(fromUrl("https://nearblocks.io/address/x.near")!.network).toBe("mainnet");
  });
  it("reads ?network= and /testnet/ path hints, and testnet.* hosts", () => {
    expect(fromUrl("https://example.app/send?network=testnet")!.network).toBe("testnet");
    expect(fromUrl("https://example.app/send?networkId=mainnet")!.network).toBe("mainnet");
    expect(fromUrl("https://example.app/testnet/send")!.network).toBe("testnet");
    expect(fromUrl("https://example.app/#/mainnet/send")!.network).toBe("mainnet");
    expect(fromUrl("https://testnet.someapp.xyz/")!.network).toBe("testnet");
  });
  it("says nothing for wallets with an in-app switch, like Meteor", () => {
    expect(fromUrl("https://wallet.meteorwallet.app/wallet/send")).toBeNull();
    expect(fromUrl("https://wallet.intear.tech/")).toBeNull();
    expect(fromUrl("https://example.app/blog/mainnet-launch")).toBeNull();
    expect(fromUrl("not a url")).toBeNull();
  });
});

describe("network from page text", () => {
  it("trusts the signed-in account in the header", () => {
    const h = fromTexts([{ text: "hammed-stampdue.testnet", header: true }])!;
    expect(sure(h)).toEqual(["testnet", "account", true]);
    expect(h.why).toBe("from your wallet's account (hammed-stampdue.testnet)");
  });
  it("ignores help text and sentences that merely mention .near", () => {
    expect(fromTexts([{ text: "The account ID must include a Top Level Account such as .near or contain exactly 64 characters.", header: false }])).toBeNull();
    expect(fromTexts([{ text: "such as .near", header: true }])).toBeNull();
  });
  it("a menu listing both Testnet and Mainnet is no signal; a lone badge is a weak one", () => {
    expect(fromTexts([{ text: "Mainnet", header: true }, { text: "Testnet", header: true }])).toBeNull();
    expect(sure(fromTexts([{ text: "Testnet", header: false }])!)).toEqual(["testnet", "label", false]);
  });
  it("accounts elsewhere on the page only count when they agree, and never as sure", () => {
    expect(sure(fromTexts([{ text: "a.near", header: false }, { text: "b.near", header: false }])!)).toEqual(["mainnet", "page-account", false]);
    expect(fromTexts([{ text: "a.near", header: false }, { text: "b.testnet", header: false }])).toBeNull();
  });
  it("a header with accounts on both networks is not sure", () => {
    expect(fromTexts([{ text: "a.near", header: true }, { text: "b.testnet", header: true }])).toBeNull();
  });
});

describe("deciding (Auto never blocks on a guess)", () => {
  const meteorTestnet: NetHint = { network: "testnet", source: "account", sure: true, why: "from your wallet's account (hammed-stampdue.testnet)" };
  const weak: NetHint = { network: "mainnet", source: "label", sure: false, why: 'the page says "Mainnet"' };
  const none: NetHint = { network: null, source: "default", sure: false, why: "" };

  it("manual mode wins and may block", () => {
    expect(decide("mainnet", meteorTestnet, "x.testnet")).toMatchObject({ network: "mainnet", mismatchAllowed: true, hint: { why: "set by you in Gideon" } });
  });
  it("a sure page decides, even against the recipient's suffix", () => {
    expect(decide("auto", meteorTestnet, "alice.near")).toMatchObject({ network: "testnet", mismatchAllowed: true });
  });
  it("a weak page signal gives way to the recipient's own suffix", () => {
    const d = decide("auto", weak, "adelekejrtx.testnet");
    expect(d).toMatchObject({ network: "testnet", mismatchAllowed: false });
    expect(d.hint.why).toContain("double-check your wallet's network");
  });
  it("no page signal: the recipient's suffix, or both networks", () => {
    expect(decide("auto", none, "bob.near")).toMatchObject({ network: "mainnet", mismatchAllowed: false });
    expect(decide("auto", none, "a".repeat(64)).network).toBe("both");
  });
});

describe("resolving 'both' with two cheap lookups", () => {
  const hex = "ab".repeat(32);
  const on = (nets: string[]) => ({ viewAccount: async (n: string) => (nets.includes(n) ? { amountYocto: "1", codeHash: "1".repeat(32), storageUsage: 1 } : null) });
  it("checks where the account lives", async () => {
    expect((await resolveNetwork("auto", undefined, hex, on(["testnet"]))).network).toBe("testnet");
    expect((await resolveNetwork("auto", undefined, hex, on(["mainnet"]))).network).toBe("mainnet");
    expect((await resolveNetwork("auto", undefined, hex, on(["mainnet", "testnet"]))).why).toContain("exists on both");
    expect((await resolveNetwork("auto", undefined, hex, on([]))).why).toContain("not found on either");
  });
  it("doesn't look anything up when the page or suffix already says", async () => {
    const spy = vi.fn(async () => null);
    expect((await resolveNetwork("auto", undefined, "x.testnet", { viewAccount: spy })).network).toBe("testnet");
    expect((await resolveNetwork("testnet", undefined, hex, { viewAccount: spy })).network).toBe("testnet");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("Meteor's send screen (local reconstruction)", () => {
  it("finds the Send To field and its Send button", () => {
    const f = meteor();
    expect(isRecipientField(f)).toBe(true);
    expect(findSendButtons(f).map((b) => b.textContent)).toContain("Send");
  });
  it("reads testnet from the signed-in account, with the network menu open or closed", () => {
    for (const menu of [false, true]) {
      const f = meteor({ menu });
      const h = pageHint("https://wallet.meteorwallet.app/wallet/send", collectSignals(document, recipientScope(f)));
      expect(sure(h)).toEqual(["testnet", "account", true]);
      expect(h.why).toBe("from your wallet's account (hammed-stampdue.testnet)");
    }
  });
  it("reads mainnet when the signed-in account is a .near one", () => {
    const f = meteor({ account: "hammed.near" });
    expect(pageHint("https://wallet.meteorwallet.app/wallet/send", collectSignals(document, recipientScope(f))).network).toBe("mainnet");
  });
  it("never reads the address typed into Send To as 'your account'", () => {
    const f = meteor({ account: "" });
    f.value = "alice.near";
    f.parentElement!.insertAdjacentHTML("beforeend", "<div>alice.near</div>");
    expect(pageHint("https://wallet.meteorwallet.app/wallet/send", collectSignals(document, recipientScope(f))).network).toBeNull();
  });
  it("without layout (account bar not known to be at the top) it is a likely hint, not a sure one", () => {
    const f = meteor({ layout: false });
    expect(sure(pageHint("https://wallet.meteorwallet.app/wallet/send", collectSignals(document, recipientScope(f))))).toEqual(["testnet", "page-account", false]);
  });

  // Hammed's 0.2.0 report: signed in as hammed-stampdue.testnet, typed adelekejrtx.testnet,
  // Gideon (popup set to mainnet) said "That's a testnet name, but you're sending on mainnet".
  it("Hammed's case: Auto checks on testnet, so no network-mismatch block", async () => {
    const f = meteor();
    const page = pageHint("https://wallet.meteorwallet.app/wallet/send", collectSignals(document, recipientScope(f)));
    const live = empty({ viewAccount: async () => ({ amountYocto: "5000000000000000000000000", codeHash: "11111111111111111111111111111111", storageUsage: 182 }) });
    const net = await resolveNetwork("auto", page, "adelekejrtx.testnet", live);
    expect(net.network).toBe("testnet");
    const r = await check({ to: "adelekejrtx.testnet", network: net.network }, live);
    expect(r.findings.find((x) => x.rule === "R1")?.status).toBe("PASS");
    expect(r.findings.some((x) => x.code === "NETWORK_MISMATCH")).toBe(false);
    const html = card(r, { net });
    expect(html).toContain("network →");
    expect(html).toMatch(/testnet · from your wallet(&#39;|&#x27;|')s account \(hammed-stampdue\.testnet\)/);
  });
  it("…and a .near recipient from that testnet wallet is still stopped, with the reason", async () => {
    const f = meteor();
    const page = pageHint("https://wallet.meteorwallet.app/wallet/send", collectSignals(document, recipientScope(f)));
    const live = empty({ viewAccount: async () => null });
    const net = await resolveNetwork("auto", page, "alice.near", live);
    const r = await check({ to: "alice.near", network: net.network }, live);
    expect(r.verdict).toBe("BLOCKED");
    expect(r.headline?.code).toBe("NETWORK_MISMATCH");
  });
});

describe("card placement on phones", () => {
  const phone = { left: 0, top: 0, width: 360, height: 740 };
  it("fits a 360px screen", () => {
    const p = placement({ left: 16, top: 200, bottom: 246, width: 328 }, phone, 260);
    expect(p.width).toBeLessThanOrEqual(344);
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.left + p.width).toBeLessThanOrEqual(352);
    expect(p.side).toBe("below");
  });
  it("flips above the field when the keyboard leaves no room below", () => {
    const withKeyboard = { left: 0, top: 0, width: 360, height: 420 };
    const p = placement({ left: 16, top: 300, bottom: 346, width: 328 }, withKeyboard, 260);
    expect(p.side).toBe("above");
    expect(p.top).toBeGreaterThanOrEqual(8);
    expect(p.top + 260).toBeLessThanOrEqual(300);
  });
  it("keeps desktop behaviour: under the field, 300-460px wide", () => {
    const p = placement({ left: 100, top: 200, bottom: 240, width: 520 }, { left: 0, top: 0, width: 1280, height: 800 }, 300);
    expect(p).toMatchObject({ width: 460, left: 100, top: 248, side: "below" });
  });
  it("a card taller than the room left by the keyboard scrolls inside itself instead of running off screen", () => {
    const p = placement({ left: 28, top: 150, bottom: 196, width: 304 }, { left: 0, top: 0, width: 360, height: 400 }, 457);
    expect(p.side).toBe("below");
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(400);
  });
});
