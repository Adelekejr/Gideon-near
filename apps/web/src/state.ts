import type { Contact, Network } from "@gideon/core";
import { DEFAULT_NETWORK } from "@gideon/core";

const NET_KEY = "gideon.network";
const BOOK_KEY = "gideon.contacts";

export function getNetwork(): Network {
  const q = new URLSearchParams(location.search).get("net");
  if (q === "mainnet" || q === "testnet") return q;
  const v = localStorage.getItem(NET_KEY);
  return v === "mainnet" || v === "testnet" ? v : DEFAULT_NETWORK;
}
export function setNetwork(n: Network) { localStorage.setItem(NET_KEY, n); }

/** Saved contacts live only in this browser (localStorage). */
export function getContacts(): Contact[] {
  try {
    const v = JSON.parse(localStorage.getItem(BOOK_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((c) => c && typeof c.account === "string") : [];
  } catch { return []; }
}
export function saveContacts(c: Contact[]) { localStorage.setItem(BOOK_KEY, JSON.stringify(c)); }
