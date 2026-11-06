import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const popup = readFileSync(join(here, "popup.html"), "utf8");
const themeJs = readFileSync(join(here, "static/theme.js"), "utf8");

describe("popup.html content security policy", () => {
  it("has no inline script", () => {
    const scripts = [...popup.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attrs, body] of scripts) {
      expect(attrs).toMatch(/\bsrc\s*=\s*["'][^"']+["']/);
      expect(body.trim()).toBe("");
    }
  });

  it("loads the saved-theme file from the head, before the body, without async or defer", () => {
    const headEnd = popup.indexOf("</head>");
    const tag = '<script src="theme.js"></script>';
    const at = popup.indexOf(tag);
    expect(at).toBeGreaterThan(popup.indexOf("<head"));
    expect(at).toBeLessThan(headEnd);
    expect(at).toBeLessThan(popup.indexOf("<body"));
    expect(popup.slice(popup.indexOf("<head"), headEnd)).not.toMatch(/\b(?:async|defer)\b/);
  });

  it("has no inline event handlers", () => {
    expect(popup).not.toMatch(/\son[a-z]+\s*=/i);
  });
});

function paint(opts: { theme?: string; shift?: string; dark?: boolean; throwStorage?: boolean }) {
  const w = new Window({
    url: "chrome-extension://gideon/popup.html",
    settings: { device: { prefersColorScheme: opts.dark ? "dark" : "light" } },
  });
  if (opts.throwStorage) {
    Object.defineProperty(w, "localStorage", { configurable: true, get() { throw new Error("denied"); } });
  } else {
    if (opts.theme != null) w.localStorage.setItem("gideon:theme", opts.theme);
    if (opts.shift != null) w.localStorage.setItem("gideon:shift", opts.shift);
  }
  w.eval(themeJs);
  return {
    mode: w.document.documentElement.getAttribute("data-mode"),
    theme: w.document.documentElement.getAttribute("data-theme"),
  };
}

describe("saved theme before first paint", () => {
  it("uses a saved light, dark, or system choice", () => {
    expect(paint({ theme: "light", dark: true })).toEqual({ mode: "light", theme: "light" });
    expect(paint({ theme: "dark", dark: false })).toEqual({ mode: "dark", theme: "dark" });
    expect(paint({ theme: "system", dark: true })).toEqual({ mode: "system", theme: "dark" });
    expect(paint({ theme: "system", dark: false })).toEqual({ mode: "system", theme: "light" });
  });

  it("maps a legacy shift when the saved theme is missing or not a mode", () => {
    expect(paint({ shift: "night" })).toEqual({ mode: "dark", theme: "dark" });
    expect(paint({ shift: "plan" })).toEqual({ mode: "dark", theme: "dark" });
    expect(paint({ shift: "day", dark: true })).toEqual({ mode: "light", theme: "light" });
    expect(paint({ shift: "signal" })).toEqual({ mode: "light", theme: "light" });
    expect(paint({ theme: "nope", shift: "night", dark: false })).toEqual({ mode: "dark", theme: "dark" });
  });

  it("follows this device when nothing is saved, including when storage throws", () => {
    expect(paint({ dark: true })).toEqual({ mode: "system", theme: "dark" });
    expect(paint({})).toEqual({ mode: "system", theme: "light" });
    expect(paint({ throwStorage: true, dark: true })).toEqual({ mode: "system", theme: "dark" });
  });
});
