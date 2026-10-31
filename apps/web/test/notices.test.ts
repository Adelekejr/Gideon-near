import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const at = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

describe("fix 8: notices and privacy ship with the website", () => {
  it("public/ carries the same THIRD_PARTY_NOTICES.txt, PRIVACY.md and LICENSE as the repo", () => {
    expect(at("../public/THIRD_PARTY_NOTICES.txt")).toBe(at("../../../THIRD_PARTY_NOTICES.txt"));
    expect(at("../public/PRIVACY.md")).toBe(at("../../extension/PRIVACY.md"));
    expect(at("../public/LICENSE.txt")).toBe(at("../../../LICENSE"));
  });
  it("the notices hold the real font licences and the library licences", () => {
    const n = at("../../../THIRD_PARTY_NOTICES.txt");
    expect(n).toMatch(/Copyright 2020 The Archivo Project Authors/);
    expect(n).toMatch(/Copyright 2020 The JetBrains Mono Project Authors/);
    expect(n.match(/SIL OPEN FONT LICENSE Version 1\.1/g)?.length).toBe(2);
    expect(n).toMatch(/noble-hashes/); expect(n).toMatch(/noble-ed25519/);
    expect(n).toMatch(/near-connect/); expect(n).toMatch(/Apache License/);
  });
  it("the home page doesn't claim website receipts are signed", () => {
    const h = at("../index.html");
    expect(h).toContain("Receipts made on this website are unsigned.");
    expect(h).not.toContain("so a wallet or agent can prove it checked before it sent");
  });
});
