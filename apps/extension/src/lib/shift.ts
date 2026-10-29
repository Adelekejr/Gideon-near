/** Colour shifts, shared with the website. AUTO follows this device's clock: Day Shift from 06:00, Night Watch from 18:30. Plan and Signal are manual picks. */
export type Shift = "auto" | "day" | "night" | "plan" | "signal";
export type Theme = Exclude<Shift, "auto">;
export const SHIFTS: [Shift, string][] = [["auto", "AUTO"], ["day", "DAY"], ["night", "NIGHT"], ["plan", "PLAN"], ["signal", "SIGNAL"]];
export const SHIFT_NAMES: Record<Theme, string> = { day: "Day Shift", night: "Night Watch", plan: "Blueprint", signal: "Signal Box" };

export function autoTheme(d = new Date()): "day" | "night" {
  const m = d.getHours() * 60 + d.getMinutes();
  return m >= 18 * 60 + 30 || m < 6 * 60 ? "night" : "day";
}
export function asShift(v: unknown): Shift {
  return v === "day" || v === "night" || v === "plan" || v === "signal" ? v : "auto";
}
export function themeOf(s: Shift, d = new Date()): Theme {
  return s === "auto" ? autoTheme(d) : s;
}

/** Stored on its own key so the settings object stays unchanged. */
export async function loadShift(): Promise<Shift> {
  try { return asShift((await chrome.storage.local.get("shift")).shift); } catch { return "auto"; }
}
export async function saveShift(s: Shift): Promise<void> {
  await chrome.storage.local.set({ shift: s });
}
