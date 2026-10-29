import type { CheckResult } from "./types.js";

/**
 * Optional "explain this in plain words" adapter. Off by default: Gideon's
 * built-in text is deterministic. A paid model (e.g. NEAR AI) can plug in here;
 * it may only rephrase, never change the verdict.
 */
export interface Explainer {
  name: string;
  explain(result: CheckResult): Promise<string>;
}

export const builtInExplainer: Explainer = {
  name: "built-in",
  async explain(r) {
    if (r.verdict === "SAFE") return "Every check that applies ran on live data and passed. Still: only send what you can afford to get wrong.";
    const h = r.headline;
    if (!h) return "Gideon found something worth a second look.";
    return [h.title + ".", h.detail, ...(h.fix ?? []).map((x, i) => `${i + 1}. ${x}`)].join(" ");
  },
};

/** Run an optional explainer; on any failure fall back to the built-in text. */
export async function explain(result: CheckResult, explainer?: Explainer | null): Promise<{ by: string; text: string }> {
  if (explainer) {
    try {
      return { by: explainer.name, text: await explainer.explain(result) };
    } catch { /* fall through */ }
  }
  return { by: builtInExplainer.name, text: await builtInExplainer.explain(result) };
}
