/** Where the card goes, in viewport (client) coordinates. Pure, so it can be tested without a browser. */

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
  width: number;
  /** Tallest the card may be before it scrolls inside itself (phone with the keyboard open). */
  maxHeight: number;
  /** Below the field, above it (keyboard up / field low on screen), or pinned to a corner. */
  side: "below" | "above" | "corner";
}

const GAP = 8;
const EDGE = 8;

/**
 * `view` is the visible viewport (window.visualViewport on phones, so the on-screen keyboard
 * and pinch zoom are accounted for). The card is never wider than the visible width minus
 * margins, so it fits a 360px phone, and it flips above the field when there's no room below.
 */
export function placement(field: Pick<DOMRect, "left" | "top" | "bottom" | "width"> | null, view: Box, cardH: number): Placement {
  const maxW = Math.max(200, view.width - EDGE * 2);
  if (!field) {
    const width = Math.min(380, maxW);
    return { width, left: view.left + view.width - width - EDGE, top: view.top + EDGE * 2, maxHeight: Math.max(160, view.height - EDGE * 4), side: "corner" };
  }
  const width = Math.min(maxW, Math.max(300, Math.min(460, field.width)));
  const minL = view.left + EDGE;
  const maxL = view.left + view.width - width - EDGE;
  const left = Math.min(Math.max(minL, field.left), Math.max(minL, maxL));
  const below = field.bottom + GAP;
  const roomBelow = view.top + view.height - below;
  const roomAbove = field.top - GAP - view.top;
  if (roomBelow >= cardH || roomBelow >= roomAbove) return { width, left, top: below, maxHeight: Math.max(160, roomBelow - EDGE), side: "below" };
  const h = Math.min(cardH, roomAbove - EDGE);
  return { width, left, top: Math.max(view.top + EDGE, field.top - GAP - h), maxHeight: Math.max(160, roomAbove - EDGE), side: "above" };
}
