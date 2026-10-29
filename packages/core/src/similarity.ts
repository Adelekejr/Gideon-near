/** Optimal string alignment (restricted Damerau–Levenshtein) distance. */
export function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}

/** Map characters that look alike to one form: 1/l/i → l, 0/o → o, rn → m, vv → w. */
export function skeleton(s: string): string {
  return s.toLowerCase().replace(/rn/g, "m").replace(/vv/g, "w").replace(/[1i|]/g, "l").replace(/0/g, "o");
}

const HEX_ACCOUNT = /^(0x)?[0-9a-f]+$/;

export interface Lookalike {
  reason: string;
  /** Indexes in `candidate` that differ from `trusted` (same-length strings only). */
  diff: number[];
}

/**
 * Is `candidate` a lookalike of `trusted`? Null when they're equal or clearly different.
 * - hex accounts (64-hex, 0x+40): same first 4 and last 4 characters
 * - named accounts: same homoglyph skeleton, or edit distance ≤ 2 (≤ 1 for names under 10 chars)
 */
export function lookalike(candidate: string, trusted: string): Lookalike | null {
  const a = candidate.toLowerCase(), b = trusted.toLowerCase();
  if (a === b) return null;
  const diff: number[] = [];
  if (a.length === b.length) for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
  const hexA = HEX_ACCOUNT.test(a) && a.length >= 40, hexB = HEX_ACCOUNT.test(b) && b.length >= 40;
  if (hexA || hexB) {
    if (hexA && hexB && a.length === b.length) {
      const off = a.startsWith("0x") ? 2 : 0;
      if (a.slice(off, off + 4) === b.slice(off, off + 4) && a.slice(-4) === b.slice(-4)) {
        return { reason: `Same first 4 and last 4 characters, ${diff.length} characters differ in the middle`, diff };
      }
    }
    return null;
  }
  if (skeleton(a) === skeleton(b)) return { reason: "Only look-alike characters differ (like l/1, o/0, rn/m)", diff };
  const limit = Math.min(a.length, b.length) < 10 ? 1 : 2;
  const dist = editDistance(a, b);
  if (dist <= limit) return { reason: `Differs by ${dist} character${dist === 1 ? "" : "s"}`, diff };
  return null;
}
