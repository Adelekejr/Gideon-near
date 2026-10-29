import type { OneClickStatus } from "@gideon/core";
import { ONECLICK_API } from "@gideon/core";
import { json, request, SourceError, type HttpOptions } from "./http.js";

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
    return await json<OneClickStatus>(res, url);
  }
}
