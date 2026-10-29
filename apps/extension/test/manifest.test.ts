import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));

describe("manifest", () => {
  it("is MV3 and asks only for storage", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(["storage"]);
  });
  it("host permissions cover every host the sources call, and nothing else", () => {
    const src = readdirSync(join(here, "../../packages/sources/src"))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => join(here, "../../packages/sources/src", f))
      .concat(join(here, "../../packages/core/src/networks.ts"))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    // Explorer links shown to the user, and the optional keyed NEAR AI adapter (off by default, not in the extension).
    const notFetched = new Set(["tronscan.org", "etherscan.io", "nearblocks.io", "testnet.nearblocks.io", "cloud-api.near.ai"]);
    const hosts = new Set([...src.matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/g)].map((m) => m[1]!).filter((h) => !notFetched.has(h)));
    expect(hosts.size).toBeGreaterThanOrEqual(10);
    const allowed: string[] = manifest.host_permissions.map((h: string) => new URL(h.replace("/*", "/")).host);
    for (const h of hosts) expect(allowed, h).toContain(h);
    expect(manifest.host_permissions.some((h: string) => h.includes("<all_urls>"))).toBe(false);
  });
});
