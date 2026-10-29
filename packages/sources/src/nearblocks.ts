import type { NearTx, Network, Transfer } from "@gideon/core";
import { NETWORKS } from "@gideon/core";
import { json, request, SourceError, type HttpOptions } from "./http.js";

/** NearBlocks free API (no key, about 6 calls/minute). */
export class NearBlocks {
  constructor(private o: HttpOptions = {}) {}

  private async get<T>(network: Network, path: string): Promise<{ status: number; body: T | null }> {
    const url = `${NETWORKS[network].nearblocksApi}${path}`;
    const res = await request(url, { headers: { accept: "application/json" } }, this.o);
    if (res.status === 404) return { status: 404, body: null };
    if (res.status === 429) throw new SourceError("NearBlocks rate limit reached");
    if (!res.ok) throw new SourceError(`NearBlocks HTTP ${res.status}`);
    return { status: res.status, body: await json<T>(res, url) };
  }

  async recentTransfers(network: Network, accountId: string): Promise<Transfer[]> {
    const { body } = await this.get<{ txns?: any[] }>(network, `/v1/account/${encodeURIComponent(accountId)}/txns-only?per_page=25&order=desc`);
    return (body?.txns ?? []).map((t) => ({
      hash: t.transaction_hash,
      signer: t.signer_account_id ?? t.predecessor_account_id,
      receiver: t.receiver_account_id,
      depositYocto: Number(t.actions_agg?.deposit ?? 0),
      blockTimestampNs: t.block_timestamp,
    }));
  }

  async nearTx(network: Network, hash: string): Promise<NearTx | null> {
    const { body } = await this.get<{ txns?: any[] }>(network, `/v1/txns/${encodeURIComponent(hash)}`);
    const t = body?.txns?.[0];
    if (!t) return null;
    return { hash: t.transaction_hash, signer: t.signer_account_id, receiver: t.receiver_account_id, blockTimestampNs: t.block_timestamp };
  }
}
