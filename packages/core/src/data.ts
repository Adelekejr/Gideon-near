import exchangesJson from "../data/exchanges.json" with { type: "json" };
import tokensJson from "../data/tokens.json" with { type: "json" };
import type { Network } from "./types.js";

export interface ExchangeEntry {
  id: string;
  name: string;
  /** Asset symbols the exchange credits over the NEAR network. */
  credits: string[];
  memo: "required" | "none" | "unknown";
  verified: boolean;
  source: string | null;
  note: string;
}

export interface TokenEntry {
  symbol: string;
  contract: string;
  decimals: number;
  kind: "canonical" | "bridged";
}

export const EXCHANGES_CHECKED: string = exchangesJson._checked;

export function exchangesFor(network: Network): ExchangeEntry[] {
  return exchangesJson[network] as ExchangeEntry[];
}

export function findExchange(network: Network, id?: string): ExchangeEntry {
  const list = exchangesFor(network);
  return list.find((e) => e.id === (id ?? "generic")) ?? list.find((e) => e.id === "generic")!;
}

export function tokensFor(network: Network): TokenEntry[] {
  return tokensJson[network] as TokenEntry[];
}

export function tokenByContract(network: Network, contract: string): TokenEntry | undefined {
  return tokensFor(network).find((t) => t.contract === contract);
}

export function tokenBySymbol(network: Network, symbol: string): TokenEntry | undefined {
  return tokensFor(network).find((t) => t.symbol.toLowerCase() === symbol.toLowerCase() && t.kind === "canonical");
}

/** Symbols scammers copy. A token claiming one of these on an unknown contract is fake. */
export const PROTECTED_SYMBOLS = ["NEAR", "WNEAR", "USDC", "USDT"];
