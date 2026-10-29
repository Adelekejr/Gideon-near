/** The Arrow G plays a real verdict (same motion as the website).
 *  BLOCKED: the arrow hits the wall and bounces (1.0s). ATTENTION: it stops at an amber wall and waits, no pass (0.9s).
 *  SAFE: the wall drops open and the arrow passes through (1.1s). Reduced motion: the final pose only. */
export type StopState = "block" | "safe" | "warn" | "idle";
const STOP = "cubic-bezier(.5,0,.9,.55)", OUT = "cubic-bezier(.2,.7,.3,1)", IO = "cubic-bezier(.4,0,.2,1)";
const BLOCKED = "#FF4D1A", ATTENTION = "#F4B400", SAFE = "#2DB36F";

export function reducedMotion(): boolean {
  try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

export function playVerdict(svg: Element | null | undefined): Promise<void> {
  if (!svg) return Promise.resolve();
  const el = svg as SVGElement;
  const state = (["block", "warn", "safe"] as const).find((s) => el.classList.contains(s));
  const done = () => { el.dataset.played = state ?? "idle"; };
  if (!state || reducedMotion() || typeof el.animate !== "function") { done(); return Promise.resolve(); }
  const arw = el.querySelector(".gs-arw") as SVGElement, wall = el.querySelector(".gs-wall") as SVGElement, hit = el.querySelector(".gs-hit") as SVGElement;
  const mute = getComputedStyle(el).getPropertyValue("--mute").trim() || "#8F8878";
  let a: Animation;
  if (state === "block") {
    a = arw.animate([
      { transform: "translateX(0px)" },
      { transform: "translateX(-16px)", offset: .25, easing: STOP },
      { transform: "translateX(6px)", offset: .55, easing: OUT },
      { transform: "translateX(-6px)", offset: .74, easing: IO },
      { transform: "translateX(-4px)" },
    ], { duration: 1000 });
    wall.animate([{ transform: "translateX(0)", fill: mute }, { transform: "translateX(0)", fill: mute, offset: .54 }, { transform: "translateX(1.8px)", fill: BLOCKED, offset: .58 }, { transform: "translateX(-.7px)", offset: .7 }, { transform: "translateX(0)", fill: BLOCKED }], { duration: 1000 });
    hit.animate([{ opacity: 0 }, { opacity: 0, offset: .55 }, { opacity: 1, offset: .6 }, { opacity: 1 }], { duration: 1000 });
  } else if (state === "warn") {
    a = arw.animate([
      { transform: "translateX(0px)" },
      { transform: "translateX(-14px)", offset: .28, easing: STOP },
      { transform: "translateX(5px)", offset: .6, easing: OUT },
      { transform: "translateX(3px)", offset: .78, easing: IO },
      { transform: "translateX(4px)" },
    ], { duration: 900 });
    wall.animate([{ fill: mute, opacity: 1 }, { fill: ATTENTION, opacity: 1, offset: .58 }, { opacity: .45, offset: .74 }, { opacity: 1, offset: .86 }, { opacity: .55, offset: .94 }, { fill: ATTENTION, opacity: 1 }], { duration: 900 });
  } else {
    wall.animate([
      { transform: "translateY(0)", opacity: 1, fill: mute },
      { transform: "translateY(0)", opacity: 1, fill: SAFE, offset: .12, easing: STOP },
      { transform: "translateY(30px)", opacity: 0, fill: SAFE, offset: .34 },
      { transform: "translateY(30px)", opacity: 0, fill: SAFE },
    ], { duration: 1100 });
    a = arw.animate([
      { transform: "translateX(0px)", opacity: 1 },
      { transform: "translateX(0px)", opacity: 1, offset: .2, easing: STOP },
      { transform: "translateX(70px)", opacity: 0, offset: .52 },
      { transform: "translateX(-30px)", opacity: 0, offset: .53, easing: OUT },
      { transform: "translateX(2px)", opacity: 1, offset: .86, easing: IO },
      { transform: "translateX(0px)", opacity: 1 },
    ], { duration: 1100 });
  }
  return new Promise((res) => { a.onfinish = () => { done(); res(); }; a.oncancel = () => { done(); res(); }; });
}

/** Play every Arrow G that has a verdict pose and hasn't played yet. */
export function playAll(root: ParentNode): void {
  root.querySelectorAll(".gs.block:not([data-played]),.gs.warn:not([data-played]),.gs.safe:not([data-played])").forEach((s) => void playVerdict(s));
}
