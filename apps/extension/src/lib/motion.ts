/** The Gate G plays a real verdict (same motion as the website).
 *  BLOCKED: the bar slams shut in red (1.0s). ATTENTION: it lifts to 45° in amber and blinks (0.9s).
 *  Couldn't check (class cnc): the same lift, then the fill empties to an amber outline. Never green.
 *  SAFE: the bar rises to 90° in green (1.1s). No tick. Reduced motion: the final pose only. */
export type StopState = "block" | "safe" | "warn" | "idle";
const STOP = "cubic-bezier(.5,0,.9,.55)", OUT = "cubic-bezier(.2,.7,.3,1)", SETTLE = "cubic-bezier(.2,.8,.2,1)";

export function reducedMotion(): boolean {
  try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

export function playVerdict(svg: Element | null | undefined): Promise<void> {
  if (!svg) return Promise.resolve();
  const el = svg as SVGElement;
  const state = (["block", "warn", "safe"] as const).find((s) => el.classList.contains(s));
  const done = () => { el.dataset.played = state ?? "idle"; };
  if (!state || reducedMotion() || typeof el.animate !== "function") { done(); return Promise.resolve(); }
  const bar = el.querySelector(".gs-bar") as SVGElement | null;
  const outline = el.querySelector(".gs-out") as SVGElement | null;
  if (!bar) { done(); return Promise.resolve(); }
  const cs = getComputedStyle(el);
  const red = cs.getPropertyValue("--b").trim() || "#D42A10";
  const amber = cs.getPropertyValue("--a").trim() || "#E8A400";
  const green = cs.getPropertyValue("--s").trim() || "#4FB57A";
  const cnc = el.classList.contains("cnc");
  // A new card starts from shut. fill:both applies the first keyframe before the first paint of the animation.
  const from = 0;
  let a: Animation;
  if (state === "block") {
    bar.style.fill = red;
    a = bar.animate([
      { transform: `rotate(${from}deg)`, offset: 0, easing: STOP },
      { transform: "rotate(0deg)", offset: .6 },
      { transform: "rotate(3deg)", offset: .75, easing: SETTLE },
      { transform: "rotate(0deg)", offset: 1 },
    ], { duration: 1000, fill: "both" });
  } else if (state === "warn") {
    bar.style.fill = amber;
    a = bar.animate([
      { transform: `rotate(${from}deg)`, offset: 0, easing: OUT },
      { transform: "rotate(50deg)", offset: .42 },
      { transform: "rotate(45deg)", offset: .5 },
      { transform: "rotate(45deg)", offset: 1 },
    ], { duration: 900, fill: "both" });
    if (cnc && outline) {
      bar.animate([{ opacity: 1, offset: 0 }, { opacity: 1, offset: .55 }, { opacity: .35, offset: .7 }, { opacity: 0, offset: .9 }, { opacity: 0, offset: 1 }], { duration: 900, fill: "both" });
      outline.animate([{ opacity: 0, offset: 0 }, { opacity: 0, offset: .7 }, { opacity: 1, offset: .9 }, { opacity: 1, offset: 1 }], { duration: 900, fill: "both" });
    } else {
      bar.animate([{ opacity: 1, offset: .5 }, { opacity: .35, offset: .72 }, { opacity: 1, offset: 1 }], { duration: 900, fill: "both" });
    }
  } else {
    bar.style.fill = green;
    a = bar.animate([
      { transform: `rotate(${from}deg)`, offset: 0, easing: SETTLE },
      { transform: "rotate(90deg)", offset: 1 },
    ], { duration: 1100, fill: "both" });
  }
  return new Promise((res) => { a.onfinish = () => { done(); res(); }; a.oncancel = () => { done(); res(); }; });
}

/** Play every Gate G that has a verdict pose and hasn't played yet. */
export function playAll(root: ParentNode): void {
  root.querySelectorAll(".gs.block:not([data-played]),.gs.warn:not([data-played]),.gs.safe:not([data-played])").forEach((s) => void playVerdict(s));
}
