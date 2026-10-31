// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { STOP_LABEL } from "@gideon/core";
import { stopper } from "../src/chrome";

describe("0.3.2 follow-up: the Arrow G's label says no more than the verdict (website)", () => {
  it("uses the shared labels, never 'send cleared'", () => {
    expect(stopper("safe")).toContain(`aria-label="${STOP_LABEL.safe}"`);
    expect(stopper("safe")).toContain('aria-label="Nothing flagged"');
    expect(stopper("block")).toContain('aria-label="Stopped"');
    expect(stopper("warn")).toContain('aria-label="Look again"');
    expect(stopper("safe")).not.toMatch(/cleared|Wall open/);
  });
});
