import type { CheckResult, Explainer } from "@gideon/core";
import { request, json, type HttpOptions } from "./http.js";

/**
 * Optional NEAR AI explainer (OpenAI-compatible chat API). Off by default:
 * only created when an API key is given. It rewrites Gideon's findings in plain
 * words; it can't change the verdict, and any error falls back to the built-in text.
 */
export function nearAiExplainer(o: HttpOptions & { apiKey: string; baseUrl?: string; model?: string }): Explainer {
  const base = o.baseUrl ?? "https://cloud-api.near.ai/v1";
  return {
    name: "near-ai",
    async explain(r: CheckResult) {
      const facts = { verdict: r.verdict, headline: r.headline, findings: r.findings.filter((x) => x.status !== "SKIPPED" && x.status !== "PASS") };
      const res = await request(`${base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${o.apiKey}` },
        body: JSON.stringify({
          model: o.model ?? "z-ai/glm-5.2",
          messages: [
            { role: "system", content: "Explain this crypto send check to a non-expert in at most 3 short sentences. Use only the facts given. Never change the verdict." },
            { role: "user", content: JSON.stringify(facts) },
          ],
        }),
      }, { ...o, timeoutMs: o.timeoutMs ?? 15000 });
      if (!res.ok) throw new Error(`NEAR AI HTTP ${res.status}`);
      const body = await json<any>(res, base);
      const text = body.choices?.[0]?.message?.content;
      if (!text) throw new Error("NEAR AI returned no text");
      return String(text).trim();
    },
  };
}
