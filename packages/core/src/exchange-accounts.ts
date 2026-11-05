import raw from "../data/exchange-accounts.json" with { type: "json" };
import type { Network } from "./types.js";

export interface ExchangeAccount {
  account: string;
  name: string;
  role: "hot" | "cold" | "deposit";
  source: string;
  note: string;
}

export const EXCHANGE_ACCOUNTS_CHECKED: string = raw._checked;
/** Shown with the list: per-user deposit addresses are not included. */
export const EXCHANGE_ACCOUNTS_LIMIT: string = raw._limit;

export function exchangeAccountsFor(network: Network): ExchangeAccount[] {
  return raw[network] as ExchangeAccount[];
}

/** A known exchange hot or cold wallet, or undefined. Match is case-insensitive. */
export function exchangeAccount(network: Network, account: string): ExchangeAccount | undefined {
  const id = account.trim().toLowerCase();
  return exchangeAccountsFor(network).find((e) => e.account.toLowerCase() === id);
}

export function isExchangeAccount(network: Network, account: string): boolean {
  return !!exchangeAccount(network, account);
}
