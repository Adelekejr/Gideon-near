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

/**
 * Map characters that look alike to one form: 1/l/i/| → l, 0/o → o, rn → m, vv → w, and the
 * separators "-", "_" and "." to one (so "adele-kejr.near" and "adele.kejr.near" match).
 */
export function skeleton(s: string): string {
  return s.toLowerCase().replace(/rn/g, "m").replace(/vv/g, "w").replace(/[1i|!]/g, "l").replace(/0/g, "o").replace(/[-_]/g, ".");
}

const HEX_ACCOUNT = /^(0x)?[0-9a-f]+$/;

export interface Lookalike {
  reason: string;
  /** Indexes in `candidate` that differ from `trusted` (same-length strings only). */
  diff: number[];
}

/** Characters shared at the start and at the end of two strings (never overlapping). */
export function sharedEnds(a: string, b: string): { head: number; tail: number } {
  const n = Math.min(a.length, b.length);
  let head = 0;
  while (head < n && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < n - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return { head, tail };
}

/** The part of a named account before its network suffix: "adelekejr" for "adelekejr.near". */
function stem(s: string): string {
  return s.replace(/\.(near|testnet|tg)$/, "");
}

/**
 * Is `candidate` a lookalike of `trusted`? Null when they're equal or clearly different.
 * - hex accounts (64-hex, 0x+40), same length: the ends match the way poisoners grind them
 *   (first and last characters together 6 or more, at least 2 at each end; or 6+ at one end),
 *   or at most 4 characters differ in total
 * - named accounts: same look-alike skeleton (1/l, 0/o, i/l, rn/m, hyphen/dot), or edit distance
 *   ≤ 2 (≤ 1 when the name is under 10 characters; names under 4 characters only by skeleton)
 */
export function lookalike(candidate: string, trusted: string): Lookalike | null {
  const a = candidate.toLowerCase(), b = trusted.toLowerCase();
  if (a === b) return null;
  const diff: number[] = [];
  if (a.length === b.length) for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
  const hexA = HEX_ACCOUNT.test(a) && a.length >= 40, hexB = HEX_ACCOUNT.test(b) && b.length >= 40;
  if (hexA || hexB) {
    if (!(hexA && hexB && a.length === b.length)) return null;
    const off = a.startsWith("0x") && b.startsWith("0x") ? 2 : 0;
    const { head, tail } = sharedEnds(a.slice(off), b.slice(off));
    const mid = `${diff.length} character${diff.length === 1 ? "" : "s"} differ in the middle`;
    if (diff.length <= 4) return { reason: `Only ${diff.length} character${diff.length === 1 ? "" : "s"} differ${diff.length === 1 ? "s" : ""}`, diff };
    if ((head >= 2 && tail >= 2 && head + tail >= 6) || head >= 6 || tail >= 6) {
      const ends = tail === 0 ? `Same first ${head} characters` : head === 0 ? `Same last ${tail} characters` : `Same first ${head} and last ${tail} characters`;
      return { reason: `${ends}, ${mid}`, diff };
    }
    return null;
  }
  if (skeleton(a) === skeleton(b)) return { reason: "Only look-alike characters differ (like l/1, o/0, i/l, rn/m, - and .)", diff };
  const sa = stem(a), sb = stem(b), suffix = (x: string, st: string) => x.slice(st.length);
  const bare = (x: string) => x.replace(/[\d._-]+$/, "");
  if (suffix(a, sa) === suffix(b, sb) && bare(sa) && bare(sa) === bare(sb)) {
    return { reason: "Same name with extra digits or symbols at the end", diff };
  }
  if (Math.min(sa.length, sb.length) < 4) return null; // "bob" vs "rob" are just different short names
  const limit = Math.min(a.length, b.length) < 10 ? 1 : 2;
  const dist = editDistance(a, b);
  if (dist <= limit) return { reason: `Differs by ${dist} character${dist === 1 ? "" : "s"}`, diff };
  return null;
}
