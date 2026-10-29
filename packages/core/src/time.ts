/** Thrown when a lookup or a whole check runs past its time limit. */
export class TimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} took longer than ${fmtSeconds(ms)}`);
    this.name = "TimeoutError";
  }
}

export function fmtSeconds(ms: number): string {
  const s = ms / 1000;
  return `${+s.toFixed(2)} s`;
}

/**
 * Settle with `p`, or reject with a TimeoutError after `ms`. The underlying work is not cancelled
 * (a source's own cache can still keep its answer for the next check); this only stops waiting.
 * `ms` undefined, non-finite or <= 0 means no limit.
 */
export function withTimeout<T>(p: Promise<T>, ms: number | undefined, what: string): Promise<T> {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return p;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(what, ms)), ms);
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}
