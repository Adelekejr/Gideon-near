export type Fetch = typeof fetch;

export interface HttpOptions {
  fetch?: Fetch;
  timeoutMs?: number;
}

export class SourceError extends Error {}

/** fetch with a timeout. Returns the Response; throws SourceError on network failure or timeout. */
export async function request(url: string, init: RequestInit, o: HttpOptions = {}): Promise<Response> {
  const f = o.fetch ?? globalThis.fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 8000);
  try {
    return await f(url, { ...init, signal: ctl.signal });
  } catch (e) {
    const host = safeHost(url);
    if ((e as Error)?.name === "AbortError") throw new SourceError(`${host} timed out`);
    throw new SourceError(`${host} unreachable`);
  } finally {
    clearTimeout(timer);
  }
}

export async function json<T>(res: Response, url: string): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new SourceError(`${safeHost(url)} returned a non-JSON reply (HTTP ${res.status})`);
  }
}

export function safeHost(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}
