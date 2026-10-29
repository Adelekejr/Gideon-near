import { isStrongAddress } from "./detect.js";

/** How long a copy counts for. After this we no longer know what's on the clipboard. */
export const COPY_TTL_MS = 2 * 60_000;

/**
 * Remembers what you copied on this page, so a paste can be compared with it (rule R9).
 * Forgets on window blur or tab switch, because then you may have copied something
 * elsewhere that the page can't see.
 */
export class ClipboardWatch {
  private copied: string | null = null;
  private at = 0;

  recordCopy(text: string, now = Date.now()): void {
    const t = text.trim();
    this.copied = t ? t : null;
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
    return isStrongAddress(this.copied) || /^[a-z\d._-]+\.(near|testnet)$/i.test(this.copied) ? this.copied : null;
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
