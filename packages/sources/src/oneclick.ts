import type { OneClickStatus } from "@gideon/core";
import { ONECLICK_API } from "@gideon/core";
import { json, request, safeHost, SourceError, type HttpOptions } from "./http.js";

/** Reject a body that isn't a status object. A cast of {} used to fall through as a quiet pass. */
export function readOneClickStatus(data: unknown, url: string): OneClickStatus {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new SourceError(`${safeHost(url)} returned a status Gideon couldn't read`);
  }
  const status = (data as { status?: unknown }).status;
  if (typeof status !== "string" || !status.trim()) {
    throw new SourceError(`${safeHost(url)} returned a status Gideon couldn't read`);
  }
  return data as OneClickStatus;
}

/**
 * NEAR Intents 1Click, read-only. Gideon only calls GET /v0/status: it never
 * asks for quotes and never moves funds. 404 = not a 1Click deposit address.
 */
export class OneClick {
  constructor(private o: HttpOptions & { baseUrl?: string } = {}) {}

  async status(depositAddress: string): Promise<OneClickStatus | null> {
    const url = `${this.o.baseUrl ?? ONECLICK_API}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`;
    const res = await request(url, { headers: { accept: "application/json" } }, this.o);
    if (res.status === 404) return null;
    if (!res.ok) throw new SourceError(`1Click HTTP ${res.status}`);
    return readOneClickStatus(await json<unknown>(res, url), url);
  }
}
