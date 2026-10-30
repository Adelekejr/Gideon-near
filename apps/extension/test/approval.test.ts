import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { checkTransaction, encodeTransaction, toBase64 } from "@gideon/core";
import { approvalFromScreen, approvalFromUrl, findApproval } from "../src/lib/approval.js";
import { esc, TX_FOOTER, txCard } from "../src/lib/view.js";
import { empty } from "../../../packages/core/test/helpers.js";

const KEY = "ed25519:" + "1".repeat(43);
const b64 = toBase64(encodeTransaction({ signerId: "me.testnet", publicKey: KEY, receiverId: "me.testnet", actions: [{ type: "AddKey", publicKey: KEY, fullAccess: true }] }));

function page(url: string, html: string): Document {
  const w = new Window({ url });
  w.document.body.innerHTML = html;
  return w.document as unknown as Document;
}
const meteorScreen = (from: string, to: string, full: boolean, net = "testnet.") => `
  <h2>Approve Transaction(s)</h2>
  <div>From <a href="https://${net}nearblocks.io/address/${from}">${from}</a></div>
  <div>To <a href="https://${net}nearblocks.io/address/${to}">${to}</a></div>
  ${full ? "<div>Adds a Full Access Key: complete control of this account</div><div>This request gives full control of your account</div>" : "<div>Function call</div>"}`;

describe("approval requests in the page address", () => {
  it("MyNearWallet /sign?transactions= is read, with network and site", () => {
    const a = approvalFromUrl(`https://testnet.mynearwallet.com/sign?transactions=${encodeURIComponent(b64)}&callbackUrl=https%3A%2F%2Fdapp.example%2Fback`)!;
    expect(a.from).toBe("url");
    expect(a.network).toBe("testnet");
    expect(a.origin).toBe("dapp.example");
  });
  it("Meteor's redirect flow /connect/testnet/sign is read", () => {
    const a = approvalFromUrl(`https://wallet.meteorwallet.app/connect/testnet/sign?transactions=${encodeURIComponent(b64)}&callback_url=https%3A%2F%2Fdapp.example`)!;
    expect(a.network).toBe("testnet");
  });
  it("generic fallback: any page with real NEAR transactions in ?transactions=", () => {
    expect(approvalFromUrl(`https://other-wallet.example/approve?transactions=${encodeURIComponent(b64)}`)?.request).toBe(b64);
  });
  it("ordinary pages and junk transactions= are ignored", () => {
    expect(approvalFromUrl("https://example.com/?q=near")).toBeNull();
    expect(approvalFromUrl("https://example.com/?transactions=hello")).toBeNull();
    expect(approvalFromUrl("not a url")).toBeNull();
  });
});

describe("Meteor's approval screen (pop-up flow: nothing in the address)", () => {
  it("reads signer, receiver and the network from the From / To explorer links", () => {
    const url = "https://wallet.meteorwallet.app/connect?connectionUid=abc";
    const a = approvalFromScreen(page(url, meteorScreen("me.testnet", "fresh-app.testnet", false)), url)!;
    expect(a).toMatchObject({ from: "screen", network: "testnet", signerId: "me.testnet" });
    expect((a.request as { receiverId: string }).receiverId).toBe("fresh-app.testnet");
  });
  it("Meteor's full-access wording becomes a full-access AddKey → BLOCKED", async () => {
    const url = "https://wallet.meteorwallet.app/connect?connectionUid=abc";
    const a = approvalFromScreen(page(url, meteorScreen("me.testnet", "me.testnet", true)), url)!;
    const r = await checkTransaction({ request: a.request, network: a.network! }, empty());
    expect(r.verdict).toBe("BLOCKED");
    expect(r.headline?.code).toBe("FULL_ACCESS_KEY");
  });
  it("no approval heading → nothing", () => {
    const url = "https://wallet.meteorwallet.app/wallet";
    expect(approvalFromScreen(page(url, "<h2>Send</h2><a href='https://nearblocks.io/address/x.near'>x</a>"), url)).toBeNull();
  });
});

describe("generic approval screens (other wallets and hosts)", () => {
  it("an approval heading AND full-access wording: checked, full access only", () => {
    const url = "http://localhost:8000/meteor-approve.html";
    const a = findApproval(page(url, meteorScreen("me.testnet", "x.testnet", true)), url)!;
    expect(a.signerId).toBeUndefined(); // explorer links are only trusted on Meteor
    expect((a.request as { actions: { type: string }[] }).actions.map((x) => x.type)).toEqual(["AddKey"]);
  });
  it("words inside scripts or styles don't count: only what a person can see", () => {
    const url = "http://localhost:8000/meteor-approve.html";
    const html = "<h2>Approve Transaction(s)</h2><script>const t = 'Adds a Full Access Key: complete control of this account'</script><style>/* full access key */</style>";
    expect(findApproval(page(url, html), url)).toBeNull();
  });
  it("a docs page about full-access keys, or an approval screen without them: nothing", () => {
    const url = "https://docs.near.org/keys";
    expect(findApproval(page(url, "<h1>Access keys</h1><p>A full access key can do anything.</p>"), url)).toBeNull();
    expect(findApproval(page(url, meteorScreen("a.testnet", "b.testnet", false)), url)).toBeNull();
  });
});

describe("transaction card", () => {
  it("uses the existing card design, the approved text and footer, and escapes page values", async () => {
    const r = await checkTransaction({ request: b64, origin: "<evil>.example" }, empty());
    const html = txCard(r, { net: { network: "testnet", why: "from the wallet link" } });
    expect(html).toContain('class="gw t-block"');
    expect(html).toContain("STOPPED");
    expect(html).toContain("This site is asking for FULL ACCESS to your account.");
    expect(html).toContain("A full-access key can move all your funds. Normal sign-ins never need this.");
    expect(html).toContain(TX_FOOTER);
    expect(TX_FOOTER).toBe("Gideon only read this request from the page. It never touches your keys.");
    expect(html).not.toContain("<evil>");
  });
  it("lists every other warning under the headline", async () => {
    const two = [b64, toBase64(encodeTransaction({ signerId: "me.testnet", publicKey: KEY, receiverId: "nobody-x.testnet", actions: [{ type: "Transfer", deposit: "990" }] }))].join(",");
    const s = empty({ viewAccount: async () => ({ amountYocto: "1000", codeHash: "11111111111111111111111111111111", storageUsage: 182 }) });
    const r = await checkTransaction({ request: two }, s);
    const html = txCard(r);
    expect(html.split("This site is asking for FULL ACCESS").length).toBe(3); // headline + Details, not repeated
    expect(html).toContain(esc("This sends your whole NEAR balance to nobody-x.testnet, which Gideon hasn't seen before."));
  });
});
