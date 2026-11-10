/** Time limits for checks made from the extension (the in-page card must always resolve fast). */
export const LIMITS = {
  /** Whole check, network guess included. Past it, unanswered parts read "couldn't check in time". */
  totalMs: 6000,
  /** "Check my account": any one key or history lookup (the popup waits up to 25 s in all). */
  healthSourceMs: 6000,
  /** Any one lookup, endpoint fallbacks included. */
  sourceMs: 3000,
  /** One HTTP request (so a second RPC endpoint still gets a turn inside sourceMs). */
  requestMs: 2000,
  /** Creation date and archival dating together; the verdict never waits longer for them. */
  optionalMs: 1500,
  /**
   * Your own history (recent sends for lookalikes, "sent here before?") on one shared budget.
   * Info-only: past it, lookalikes are compared with saved contacts only and the first-send note is left out.
   */
  historyMs: 2500,
  /** Your recent history is reused for this long (a new send shows up after it). */
  historyCacheMs: 60_000,
  /** The content script stops waiting for the service worker after this. */
  pageWaitMs: 8000,
  /** Typing pause before a typed (not pasted) address is checked. */
  debounceMs: 700,
  /**
   * Finished address checks and account lookups are reused for this long.
   * Full results for deposit / Intents checks are not reused (see cacheable in runcache.ts):
   * quote expiry and swap completion can change inside this window.
   */
  cacheMs: 3 * 60_000,
  /** One follow-up to fill in a creation date that missed the first answer. */
  refillAfterMs: 2500,
  /**
   * The drained-wallet check (R18), run after the card shows: the whole look at recent senders.
   * Past it the card records a failed check (look again, never a pass).
   */
  drainerMs: 8000,
  /** The page stops waiting for the drained-wallet answer after this. */
  drainerWaitMs: 10_000,
  /** The page stops waiting for a transaction request's check (lookups plus drained-wallet links) after this. */
  txWaitMs: 14_000,
} as const;
