import { isStrongAddress } from "./detect.js";

/** How long a copy counts for. After this we no longer know what's on the clipboard. */
export const COPY_TTL_MS = 2 * 60_000;

/** Only text shaped like an address is ever kept; anything else you copy is ignored. */
export function addressLike(text: string): boolean {
  const t = text.trim();
  return !!t && t.length <= 120 && (isStrongAddress(t) || /^[a-z\d._-]+\.(near|testnet)$/i.test(t));
}

/**
 * Remembers the address you copied on this page (in memory only, never stored or sent), so a paste can be compared with it (rule R9).
 * Forgets on window blur or tab switch, because then you may have copied something
 * elsewhere that the page can't see.
 */
export class ClipboardWatch {
  private copied: string | null = null;
  private at = 0;

  recordCopy(text: string, now = Date.now()): void {
    const t = text.trim();
    this.copied = addressLike(t) ? t : null;
    this.at = now;
  }

  reset(): void {
    this.copied = null;
  }

  /** The copied text to compare a paste with, or null when we don't know. */
  copiedFor(now = Date.now()): string | null {
    if (!this.copied) return null;
    if (now - this.at > COPY_TTL_MS) {
      this.copied = null;
      return null;
    }
    return this.copied;
  }
}

/**
 * In a copy event, a page script that called preventDefault() and set its own data
 * has replaced what you selected. Returns the replacement when it's an address that
 * differs from the selection.
 */
export function copyTampered(selected: string, written: string | null | undefined, defaultPrevented: boolean): string | null {
  if (!defaultPrevented || !written) return null;
  const s = selected.trim();
  const w = written.trim();
  if (!w || w === s) return null;
  return isStrongAddress(w) || /\.(near|testnet)$/i.test(w) ? w : null;
}
