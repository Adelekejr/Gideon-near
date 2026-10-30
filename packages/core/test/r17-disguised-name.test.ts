import { describe, expect, it } from "vitest";
import { disguisedAs } from "../src/rules/r17-disguised-name.js";
import { acct, empty, find, run } from "./helpers.js";

const FULL: [string, string][] = [
  ["0x8ba1f109551bd432803012645ac136ddd64dba72.near", "Ethereum"],
  ["tjcnkvfxfrwhawbpn7eklzdq9cuyt9ajuz.near", "TRON"],
  ["tr7nhqjekqxgtci8q8zy4pl8otszgjlj6t.tg", "TRON"],
  ["bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq.near", "Bitcoin"],
  ["1a1zp1ep5qgefi2dmptftl5slmv7divfna.near", "Bitcoin"],
  ["axelar1yzsury9fldydgk425gmphy2zyehh3emc43ds6xusdt.near", "Axelar"],
  ["cosmos1hsk6jryyqjfhp5dhc55tc9jtckygx0eph6dd02.near", "Cosmos Hub"],
  ["osmo1hsk6jryyqjfhp5dhc55tc9jtckygx0eph6dd02.testnet", "Osmosis"],
  ["7xkxtg2cw87d97txjsdpbd5jbkhetqa83tzrujosgasu.near", "Solana"],
];
const PARTIAL = [
  "0x8ba1f109551bd432.near",
  "0x8ba1f109551bd432803012645ac136ddd64dba72-pay.near",
  "tjcnk9vfxfrw4hawbpn7ek.near",
  "bc1qar0srrr7xfkvy5l6.near",
  "axelar1yzsury9fldydgk42.near",
];
// Real names and real token accounts that carry an address on purpose.
const REAL = [
  "0xbob.near", "0xshake.near", "0xdead.near", "0xdeadbeef.near", "0x1.near", "1inch.near", "3commas.near", "bc1.near",
  "cosmos1.near", "osmo1.near", "t1000.near", "tether.near", "tron.near", "solana.near", "illia.near", "harry1990.near",
  "john-doe-1984.near", "abc123def456.near", "user2024.near", "v2_1.omni.hot.tg", "app.ref-finance.near", "usdt.tether-token.near",
  "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near",
  "base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  "sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near",
  "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
];

describe("R17 NEAR name disguised as another chain's address", () => {
  it.each(FULL)("full match: %s → %s", (name, chain) => {
    expect(disguisedAs(name)).toMatchObject({ match: "full", chain });
  });
  it.each(PARTIAL)("partial match: %s", (name) => {
    expect(disguisedAs(name)?.match).toBe("partial");
  });
  it.each(REAL)("real name passes: %s", (name) => {
    expect(disguisedAs(name)).toBeNull();
  });

  it("blocks a TRON-shaped .near with a plain explanation", async () => {
    const r = await run({ to: "tjcnkvfxfrwhawbpn7eklzdq9cuyt9ajuz.near", network: "mainnet" }, empty({ viewAccount: async () => acct(1) }));
    const x = find(r, "R17")[0];
    expect(x.status).toBe("BLOCKED");
    expect(x.title).toBe("This is a NEAR name made to look like a TRON address");
    expect(r.verdict).toBe("BLOCKED");
    expect(r.headline?.rule).toBe("R17");
  });

  it("look again for a partial resemblance", async () => {
    const r = await run({ to: "0x8ba1f109551bd432.testnet" }, empty({ viewAccount: async () => acct(1) }));
    expect(find(r, "R17")[0]).toMatchObject({ status: "ATTENTION", code: "RESEMBLES_OTHER_CHAIN" });
    expect(r.verdict).toBe("ATTENTION");
  });

  it("explains a capitalised one too (R1 also blocks it)", async () => {
    const r = await run({ to: "TJCNKVFXFRWHAWBPN7EKLZDQ9CUYT9AJUZ.near", network: "mainnet" }, empty());
    expect(find(r, "R17")[0].status).toBe("BLOCKED");
    expect(r.headline?.rule).toBe("R17");
  });

  it("passes ordinary names and skips non-names", async () => {
    const ok = await run({ to: "0xbob.testnet" }, empty({ viewAccount: async () => acct(1) }));
    expect(find(ok, "R17")[0].status).toBe("PASS");
    const tron = await run({ to: "TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW" }, empty());
    expect(find(tron, "R17")[0].status).toBe("SKIPPED");
  });
});
