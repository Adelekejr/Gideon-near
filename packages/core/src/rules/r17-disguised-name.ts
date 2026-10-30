import type { Ctx } from "../context.js";
import { f, skipped, short, type RuleResult } from "./util.js";

/**
 * R17 — a NEAR name made to look like another chain's address: "0x1234…abcd.near",
 * "tjcnk….near", "bc1q….near", "axelar1….near". Anyone can register such a name, so a send meant
 * for that chain lands with whoever registered it. Local only, no lookups.
 */

const NAMED = /^(([a-z\d]+[-_])*[a-z\d]+\.)+([a-z\d]+[-_])*[a-z\d]+$/;
const BECH32 = "[02-9ac-hj-np-z]";
/** Lowercased base58: a NEAR name can't hold capitals, so a copied Tron/Solana/BTC address shows up like this. */
const B58L = "[1-9a-z]";

/** Cosmos-family bech32 prefixes Gideon names; any other `word1` + 38 bech32 characters is "a Cosmos-style address". */
const COSMOS: Record<string, string> = {
  cosmos: "Cosmos Hub", osmo: "Osmosis", axelar: "Axelar", celestia: "Celestia", inj: "Injective", sei: "Sei", terra: "Terra",
  kava: "Kava", juno: "Juno", evmos: "Evmos", noble: "Noble", dydx: "dYdX", stride: "Stride", akash: "Akash", secret: "Secret",
  neutron: "Neutron", stars: "Stargaze", persistence: "Persistence", band: "Band", bnb: "BNB Beacon Chain", thor: "THORChain",
  maya: "Maya", kujira: "Kujira", umee: "Umee", regen: "Regen", archway: "Archway", dym: "Dymension", saga: "Saga", union: "Union",
};

/**
 * Token and bridge accounts whose names carry another chain's address on purpose
 * (e.g. "base-0x8335….omft.near", "a0b8….factory.bridge.near"). Never flagged.
 */
const ADDRESS_FACTORIES = [".omft.near", ".factory.bridge.near", ".omdep.near", ".bridge.near", ".omft.testnet", ".factory.sepolia.testnet", ".factory.goerli.testnet"];

export interface Disguise {
  /** "full": the name part IS another chain's address format. "partial": it only resembles one. */
  match: "full" | "partial";
  /** e.g. "a TRON address", "an Axelar address". */
  what: string;
  /** Chain name for short labels, e.g. "TRON". */
  chain: string;
  /** The part of the name that looks like an address (the first label). */
  part: string;
}

const article = (chain: string) => `${/^[AEIOU]/.test(chain) ? "an" : "a"} ${chain} address`;
const digits = (s: string) => (s.match(/\d/g) ?? []).length;
const letters = (s: string) => (s.match(/[a-z]/g) ?? []).length;
/** Letter↔digit switches: random addresses switch often, words and names rarely. */
const switches = (s: string) => { let n = 0; for (let i = 1; i < s.length; i++) if (/\d/.test(s[i]) !== /\d/.test(s[i - 1])) n++; return n; };
const randomish = (s: string, minDigits: number, minSwitches: number) => digits(s) >= minDigits && letters(s) >= 3 && switches(s) >= minSwitches;

function full(part: string): Disguise | null {
  const d = (what: string, chain: string): Disguise => ({ match: "full", what, chain, part });
  if (/^0x[0-9a-f]{40}$/.test(part)) return d("an Ethereum (EVM) address", "Ethereum");
  if (new RegExp(`^(bc|tb)1${BECH32}{39}$`).test(part)) return d("a Bitcoin address", "Bitcoin");
  if (new RegExp(`^ltc1${BECH32}{39}$`).test(part)) return d("a Litecoin address", "Litecoin");
  // Known prefixes: any address-length tail (scam names aren't always valid bech32 lengths). Unknown ones: exact lengths only.
  const cos = new RegExp(`^([a-z]{2,12})1(${BECH32}{30,58})$`).exec(part);
  if (cos && COSMOS[cos[1]] && digits(cos[2]) >= 3) return d(article(COSMOS[cos[1]]), COSMOS[cos[1]]);
  if (cos && (cos[2].length === 38 || cos[2].length === 58) && digits(cos[2]) >= 3) return d("a Cosmos-style address", "Cosmos");
  if (new RegExp(`^t${B58L}{33}$`).test(part) && randomish(part, 1, 2)) return d("a TRON address", "TRON");
  if (/^(eq|uq)[a-z0-9_-]{46}$/.test(part) && randomish(part, 3, 4)) return d("a TON address", "TON");
  if (new RegExp(`^[13]${B58L}{25,33}$`).test(part) && randomish(part, 3, 4)) return d("a Bitcoin address", "Bitcoin");
  if (new RegExp(`^r${B58L}{24,33}$`).test(part) && randomish(part, 3, 5)) return d("an XRP address", "XRP");
  if (new RegExp(`^${B58L}{32,44}$`).test(part) && randomish(part, 4, 6)) return d("a Solana address", "Solana");
  return null;
}

function partial(part: string): Disguise | null {
  const d = (what: string, chain: string): Disguise => ({ match: "partial", what, chain, part });
  // A full address with something added before or after it ("0x…-pay", "pay-0x…").
  for (const piece of part.split(/[-_]/)) if (piece !== part) { const x = full(piece); if (x) return d(x.what, x.chain); }
  if (/^0x[0-9a-f]{10,}$/.test(part) && digits(part.slice(2)) >= 2 && letters(part.slice(2)) >= 2) return d("an Ethereum (EVM) address", "Ethereum");
  if (new RegExp(`^(bc|tb|ltc)1${BECH32}{15,}$`).test(part) && digits(part) >= 3) return d("a Bitcoin address", "Bitcoin");
  const cos = new RegExp(`^([a-z]{2,12})1${BECH32}{15,}$`).exec(part);
  if (cos && COSMOS[cos[1]] && digits(part) >= 3) return d(article(COSMOS[cos[1]]), COSMOS[cos[1]]);
  if (new RegExp(`^t${B58L}{16,40}$`).test(part) && randomish(part, 3, 4)) return d("a TRON address", "TRON");
  if (new RegExp(`^${B58L}{24,}$`).test(part) && randomish(part, 4, 6)) return d("an address from another chain", "another chain");
  return null;
}

/** Does this NEAR name's first part look like another chain's address? null when it doesn't (or isn't a dotted name). */
export function disguisedAs(name: string): Disguise | null {
  const s = (name ?? "").trim().toLowerCase();
  if (s.length > 64 || !NAMED.test(s)) return null;
  if (ADDRESS_FACTORIES.some((x) => s.endsWith(x))) return null;
  const part = s.slice(0, s.indexOf("."));
  return full(part) ?? partial(part);
}

export function r17DisguisedName(ctx: Ctx): RuleResult {
  const { c } = ctx;
  // Names with capitals fail R1; still explain what they imitate.
  const raw = c.kind === "near-named" ? c.normalized : c.kind === "invalid" ? c.normalized.toLowerCase() : null;
  if (!raw || !raw.includes(".")) return skipped("R17", "Not a NEAR name.");
  const x = disguisedAs(raw);
  if (!x) return f("R17", "PASS", "NOT_DISGUISED", "Doesn't imitate another chain's address", "The name doesn't look like a Tron, Ethereum, Bitcoin, Solana or Cosmos address.");
  const shown = raw.length > 36 ? short(raw, 14, 10) : raw;
  const suffix = raw.slice(raw.indexOf("."));
  const ev = [{ label: "Name", value: shown }, { label: "Made to look like", value: x.what }];
  if (x.match === "full") {
    return f("R17", "BLOCKED", "DISGUISED_AS_OTHER_CHAIN", `This is a NEAR name made to look like ${x.what}`,
      `${shown} isn't ${x.what}. The “${suffix}” at the end makes it a NEAR account name, and anyone can register a name like this. Money sent here goes to whoever registered it on NEAR, not to that ${x.chain} address. Scammers use names like this in fake “bridge” or “arbitrage” offers.`,
      { fix: [`If you meant to pay ${x.what}, NEAR can't send there directly: use a bridge or exchange that supports ${x.chain}.`, "If someone gave you this name, don't send. Ask them for a normal NEAR account."], evidence: ev });
  }
  return f("R17", "ATTENTION", "RESEMBLES_OTHER_CHAIN", `Look again: this NEAR name looks like ${x.what}`,
    `${shown} is a NEAR account name, but its first part looks like ${x.what}. Names like this are sometimes used to trick people into thinking they're paying an address on another chain.`,
    { fix: ["Check with the receiver that this NEAR name is really theirs.", `If you meant to pay on ${x.chain}, use a bridge or exchange instead of a NEAR send.`], evidence: ev });
}
