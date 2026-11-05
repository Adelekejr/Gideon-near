import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const at = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

describe("docs page", () => {
  const html = at("../docs.html");
  const chrome = at("../src/chrome.ts");
  const vite = at("../vite.config.ts");
  const agents = at("../agents.html");

  it("is a nav page, built with the site", () => {
    expect(html).toContain('data-on="Docs"');
    expect(html).toContain('src="/src/docs.ts"');
    expect(chrome).toContain('["docs.html", "Docs"]');
    expect(chrome).toContain('href="docs.html"');
    expect(vite).toContain('docs.html');
  });

  it("explains verdicts, each door, the demos, and the newer checks", () => {
    expect(html).toContain("never sees your keys");
    expect(html).toContain("No problems found");
    expect(html).toContain("Look again");
    expect(html).toContain("Blocked");
    expect(html).toContain("SEND");
    expect(html).toContain("ASK_HUMAN");
    expect(html).toContain("DO_NOT_SEND");
    expect(html).toContain('id="checker"');
    expect(html).toContain('id="send"');
    expect(html).toContain('id="health"');
    expect(html).toContain('id="extension"');
    expect(html).toContain('id="agents"');
    expect(html).toContain("not on the Chrome Web Store or Firefox Add-ons");
    expect(html).toContain("npm run demo:attack");
    expect(html).toContain("npm run demo:function-call-key");
    expect(html).toContain("an agent that ignores");
    expect(html).toContain("Unusual amount");
    expect(html).toContain("known-exchange");
    expect(html).toContain("Swap or bridge minimum");
    expect(html).toContain("You receive at least");
    expect(html).toContain('id="limits"');
  });

  it("the agents page says the tools are what an agent calls", () => {
    expect(agents).toContain("These are MCP tools an agent calls.");
  });
});
