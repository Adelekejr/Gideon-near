import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { check } from "../src/engine.js";
import { replaySources, type Recording } from "../../sources/src/replay.js";
import { NOW } from "./helpers.js";

// Real answers from the live APIs, recorded by `npm run record`. Runs offline.
const root = new URL("../../../demo/", import.meta.url);
const { cases } = JSON.parse(readFileSync(new URL("cases.json", root), "utf8"));
const { answers } = JSON.parse(readFileSync(new URL("fixtures.json", root), "utf8")) as { answers: Recording };

describe("real-world demo cases (recorded, offline)", () => {
  it.each(cases.map((c: any) => [c.id, c]))("%s", async (_id, c: any) => {
    const r = await check(c.input, replaySources(answers), { now: NOW });
    expect(r.verdict).toBe(c.expect.verdict);
    expect(r.headline?.code ?? null).toBe(c.expect.headline);
  });
});
