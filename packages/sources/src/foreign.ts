import type { ForeignTx } from "@gideon/core";
import { json, request, SourceError, type HttpOptions } from "./http.js";

export interface ForeignOptions extends HttpOptions {
  tronApi?: string;
  ethRpc?: string;
  btcApi?: string;
}

const DEFAULTS = {
  tronApi: "https://api.trongrid.io",
  ethRpc: "https://ethereum-rpc.publicnode.com",
  btcApi: "https://mempool.space/api",
};

/** Look a hash up on other chains. Free public endpoints, no keys. */
export class ForeignChains {
  private cfg: typeof DEFAULTS;
  constructor(private o: ForeignOptions = {}) {
    this.cfg = { tronApi: o.tronApi ?? DEFAULTS.tronApi, ethRpc: o.ethRpc ?? DEFAULTS.ethRpc, btcApi: o.btcApi ?? DEFAULTS.btcApi };
  }

  async tronTx(hash: string): Promise<ForeignTx | null> {
    const url = `${this.cfg.tronApi}/wallet/gettransactionbyid`;
    const res = await request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: hash }) }, this.o);
    if (!res.ok) throw new SourceError(`TronGrid HTTP ${res.status}`);
    const body = await json<any>(res, url);
    if (!body || !body.txID) return null;
    const c = body.raw_data?.contract?.[0];
    const type: string = c?.type ?? "transaction";
    let summary = type === "TransferContract" ? `a TRX transfer of ${(Number(c.parameter?.value?.amount ?? 0) / 1e6).toLocaleString("en-US")} TRX`
      : type === "TriggerSmartContract" ? "a smart-contract call, e.g. a USDT (TRC-20) transfer" : `a ${type}`;
    return { chain: "Tron", hash, summary, explorerUrl: `https://tronscan.org/#/transaction/${hash}` };
  }

  async ethTx(hash0x: string): Promise<ForeignTx | null> {
    const url = this.cfg.ethRpc;
    const res = await request(url, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: [hash0x] }) }, this.o);
    if (!res.ok) throw new SourceError(`Ethereum RPC HTTP ${res.status}`);
    const body = await json<any>(res, url);
    if (body.error) throw new SourceError(`Ethereum RPC error: ${body.error.message ?? "unknown"}`);
    const t = body.result;
    if (!t) return null;
    const eth = Number(BigInt(t.value ?? "0x0")) / 1e18;
    return { chain: "Ethereum", hash: hash0x, summary: `from ${t.from} to ${t.to ?? "a new contract"}, ${eth.toLocaleString("en-US", { maximumFractionDigits: 6 })} ETH`,
      explorerUrl: `https://etherscan.io/tx/${hash0x}` };
  }

  async btcTx(hash: string): Promise<ForeignTx | null> {
    const url = `${this.cfg.btcApi}/tx/${hash}`;
    const res = await request(url, {}, this.o);
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new SourceError(`mempool.space HTTP ${res.status}`);
    const t = await json<any>(res, url);
    const sats = (t.vout ?? []).reduce((a: number, v: any) => a + (v.value ?? 0), 0);
    return { chain: "Bitcoin", hash, summary: `a Bitcoin transaction moving ${(sats / 1e8).toLocaleString("en-US", { maximumFractionDigits: 8 })} BTC`,
      explorerUrl: `https://mempool.space/tx/${hash}` };
  }
}
