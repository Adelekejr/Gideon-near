import type { Ctx } from "../context.js";
import { f, type RuleResult } from "./util.js";

/**
 * R15 — fake letters and hidden characters. NEAR accounts are plain lowercase a–z, 0–9, "-", "_"
 * and ".". A letter from another alphabet that looks the same (Cyrillic "а", Greek "ο"), an
 * invisible character, or an odd space inside the address means it isn't the account it looks like.
 * Reads the address exactly as pasted (before any trimming). Local only.
 */

/** Characters from other alphabets that look like a plain letter or digit. */
const LOOKS_LIKE: Record<string, string> = {
  // Cyrillic
  "а": "a", "в": "b", "е": "e", "ё": "e", "һ": "h", "і": "i", "ї": "i", "ј": "j", "к": "k", "м": "m", "н": "h", "о": "o",
  "р": "p", "с": "c", "т": "t", "у": "y", "х": "x", "ѕ": "s", "ԁ": "d", "ԛ": "q", "ԝ": "w", "ь": "b", "ӏ": "l", "ɡ": "g",
  "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X", "У": "Y", "Ѕ": "S", "І": "I", "Ј": "J",
  // Greek
  "α": "a", "β": "b", "γ": "y", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u", "χ": "x", "ω": "w", "ϲ": "c", "ϳ": "j",
  "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X",
  // Latin lookalikes and others
  "ı": "i", "ȷ": "j", "ł": "l", "ℓ": "l", "ɑ": "a", "ɩ": "i", "ʏ": "y", "ᴀ": "a", "ᴄ": "c", "ᴏ": "o", "ᴜ": "u", "ᴠ": "v", "ᴡ": "w", "ᴢ": "z",
  "á": "a", "à": "a", "â": "a", "ä": "a", "ã": "a", "å": "a", "é": "e", "è": "e", "ê": "e", "ë": "e", "í": "i", "ì": "i", "î": "i", "ï": "i",
  "ó": "o", "ò": "o", "ô": "o", "ö": "o", "õ": "o", "ú": "u", "ù": "u", "û": "u", "ü": "u", "ñ": "n", "ç": "c", "ý": "y", "ÿ": "y",
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "−": "-", "﹣": "-", "․": ".", "‧": ".", "·": ".", "。": ".", "﹒": ".",
};

const INVISIBLE: Record<number, string> = {
  0x00ad: "soft hyphen", 0x034f: "combining grapheme joiner", 0x061c: "Arabic letter mark", 0x115f: "Hangul filler", 0x1160: "Hangul filler",
  0x17b4: "Khmer vowel", 0x17b5: "Khmer vowel", 0x180e: "Mongolian vowel separator", 0x200b: "zero-width space", 0x200c: "zero-width non-joiner",
  0x200d: "zero-width joiner", 0x200e: "left-to-right mark", 0x200f: "right-to-left mark", 0x202a: "direction mark", 0x202b: "direction mark",
  0x202c: "direction mark", 0x202d: "direction override", 0x202e: "right-to-left override", 0x2060: "word joiner", 0x2061: "invisible operator",
  0x2062: "invisible operator", 0x2063: "invisible separator", 0x2064: "invisible operator", 0x2066: "direction isolate", 0x2067: "direction isolate",
  0x2068: "direction isolate", 0x2069: "direction isolate", 0x3164: "Hangul filler", 0xfe0f: "variation selector", 0xfeff: "zero-width no-break space (BOM)",
  0xffa0: "Hangul filler",
};

const SPACES: Record<number, string> = {
  0x00a0: "non-breaking space", 0x1680: "Ogham space", 0x2000: "en quad", 0x2001: "em quad", 0x2002: "en space", 0x2003: "em space",
  0x2004: "thin space", 0x2005: "thin space", 0x2006: "thin space", 0x2007: "figure space", 0x2008: "punctuation space", 0x2009: "thin space",
  0x200a: "hair space", 0x2028: "line separator", 0x2029: "paragraph separator", 0x202f: "narrow non-breaking space", 0x205f: "math space", 0x3000: "wide space",
};

function script(cp: number): string {
  if (cp >= 0x0370 && cp <= 0x03ff) return "Greek";
  if (cp >= 0x0400 && cp <= 0x052f) return "Cyrillic";
  if (cp >= 0x0530 && cp <= 0x058f) return "Armenian";
  if (cp >= 0xff00 && cp <= 0xffef) return "full-width";
  if (cp >= 0x00c0 && cp <= 0x024f) return "accented";
  if (cp >= 0x0250 && cp <= 0x02af) return "phonetic";
  if (cp >= 0x1d00 && cp <= 0x1dbf) return "small-capital";
  if (cp >= 0x2010 && cp <= 0x2015) return "typographic";
  return "non-standard";
}

const hex = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

export interface OddChar {
  char: string;
  code: string;
  /** 1-based position in the address as pasted. */
  at: number;
  kind: "lookalike" | "invisible" | "space" | "other";
  /** Plain words, e.g. "a Greek 'α' that looks like 'a'". */
  what: string;
  /** The plain character it imitates, if any. */
  looksLike?: string;
}

/** Every character that has no place in a NEAR account, except ordinary spaces at the very ends. */
export function oddCharacters(raw: string): OddChar[] {
  const out: OddChar[] = [];
  const chars = Array.from(raw ?? "");
  const first = chars.findIndex((ch) => !/[ \t\r\n]/.test(ch));
  const last = chars.length - 1 - [...chars].reverse().findIndex((ch) => !/[ \t\r\n]/.test(ch));
  chars.forEach((ch, i) => {
    const cp = ch.codePointAt(0)!;
    const code = hex(cp);
    const at = i + 1;
    if (cp < 0x80) {
      if (/[ \t\r\n]/.test(ch)) {
        if (first >= 0 && i > first && i < last) out.push({ char: ch, code, at, kind: "space", what: ch === " " ? "a space" : "a line break or tab" });
      } else if (cp < 0x20 || cp === 0x7f) out.push({ char: ch, code, at, kind: "invisible", what: `an invisible control character (${code})` });
      return;
    }
    if (INVISIBLE[cp]) return void out.push({ char: ch, code, at, kind: "invisible", what: `an invisible ${INVISIBLE[cp]} (${code})` });
    if (SPACES[cp]) return void out.push({ char: ch, code, at, kind: "space", what: `a hidden ${SPACES[cp]} (${code})` });
    if (cp >= 0xfe00 && cp <= 0xfe0f) return void out.push({ char: ch, code, at, kind: "invisible", what: `an invisible variation selector (${code})` });
    if (cp >= 0x0300 && cp <= 0x036f) return void out.push({ char: ch, code, at, kind: "invisible", what: `a hidden accent mark (${code})` });
    let plain = LOOKS_LIKE[ch];
    if (!plain && cp >= 0xff01 && cp <= 0xff5e) plain = String.fromCharCode(cp - 0xfee0);
    if (plain) return void out.push({ char: ch, code, at, kind: "lookalike", what: `${article(script(cp))} ${script(cp)} '${ch}' that looks like '${plain}'`, looksLike: plain });
    out.push({ char: ch, code, at, kind: "other", what: `${article(script(cp))} ${script(cp)} character '${ch}' (${code})` });
  });
  return out;
}

const article = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a");

/** The address with every fake letter swapped for the plain one it imitates and hidden characters removed. */
export function plainVersion(raw: string): string {
  return Array.from(raw.trim()).map((ch) => {
    const odd = oddCharacters(ch)[0];
    if (!odd) return ch;
    return odd.looksLike ?? (odd.kind === "other" ? ch : "");
  }).join("").toLowerCase();
}

export function r15FakeLetters(ctx: Ctx): RuleResult {
  const raw = ctx.input.to ?? "";
  const odd = oddCharacters(raw);
  if (!odd.length) return f("R15", "PASS", "PLAIN_CHARACTERS", "Plain characters only", "No letters from other alphabets, invisible characters or hidden spaces.");
  const first = odd[0]!;
  const more = odd.length > 1 ? ` It has ${odd.length - 1} more character${odd.length === 2 ? "" : "s"} like that.` : "";
  const plain = plainVersion(raw);
  const title = first.kind === "lookalike" ? `Fake letter: contains ${first.what}`
    : first.kind === "space" ? `Hidden space: contains ${first.what}`
    : `Hidden character: contains ${first.what}`;
  return f("R15", "BLOCKED", first.kind === "lookalike" ? "FAKE_LETTER" : first.kind === "space" ? "HIDDEN_SPACE" : first.kind === "invisible" ? "INVISIBLE_CHARACTER" : "NON_STANDARD_CHARACTER",
    title,
    `The address contains ${first.what}, at character ${first.at}.${more} NEAR accounts only use plain a–z, 0–9, "-", "_" and ".", so this isn't the account it looks like. Scammers use this to make an address look like one you trust.`,
    { fix: ["Don't send. Type the address yourself, or copy it again from the receiver's own Receive page.", ...(plain && plain !== raw.trim().toLowerCase() ? [`With plain characters it would read ${plain}. Check that with the receiver before using it.`] : [])],
      evidence: odd.slice(0, 4).map((o) => ({ label: `Character ${o.at}`, value: `${o.char.trim() ? `'${o.char}' ` : ""}${o.code}${o.looksLike ? ` → looks like '${o.looksLike}'` : ""}` })) });
}
