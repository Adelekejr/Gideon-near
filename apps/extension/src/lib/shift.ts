/** Light, dark, or the system setting. Replaces the old four colour shifts.
 *  A saved Day/Night/Plan/Signal choice is read once and stored as light or dark. */
export type Mode = "light" | "dark" | "system";
export type Theme = "light" | "dark";
export const MODES: [Mode, string][] = [["light", "Light"], ["dark", "Dark"], ["system", "Auto"]];

export function systemTheme(): Theme {
  try { return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; } catch { return "light"; }
}
export function asMode(v: unknown): Mode {
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}
/** Map a pre-Gate-G shift value onto the two themes. */
export function fromLegacyShift(v: unknown): Mode {
  if (v === "night" || v === "plan") return "dark";
  if (v === "day" || v === "signal") return "light";
  return "system";
}
export function themeOf(m: Mode): Theme {
  return m === "system" ? systemTheme() : m;
}

/** Stored on its own key so the settings object stays unchanged. */
export async function loadTheme(): Promise<Mode> {
  try {
    const got = await chrome.storage.local.get(["theme", "shift"]);
    if (got.theme === "light" || got.theme === "dark" || got.theme === "system") return got.theme;
    const migrated = fromLegacyShift(got.shift);
    await chrome.storage.local.set({ theme: migrated });
    if (got.shift != null) await chrome.storage.local.remove("shift");
    return migrated;
  } catch { return "system"; }
}
export async function saveTheme(m: Mode): Promise<void> {
  await chrome.storage.local.set({ theme: m });
  try { await chrome.storage.local.remove("shift"); } catch { /* fine */ }
}
