import type { CheckResult, Contact, Network } from "@gideon/core";

/** Everything the extension keeps, all in chrome.storage.local on this device. */
export interface Settings {
  network: Network;
  /** Check recipient fields on paste and as you type. */
  checkOnPaste: boolean;
  /** Hold the page's Send / Withdraw button while the check says BLOCKED. */
  holdSend: boolean;
  /** Compare what you copied on the page with what got pasted (rule R9). */
  clipboardCheck: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  network: "testnet",
  checkOnPaste: true,
  holdSend: true,
  clipboardCheck: true,
};

export interface Stats {
  checked: number;
  stopped: number;
}

export interface LastCheck {
  host: string;
  to: string;
  verdict: CheckResult["verdict"];
  couldNotCheck: boolean;
  title: string;
  at: string;
}

export interface Stored {
  settings: Settings;
  contacts: Contact[];
  stats: Stats;
  last: LastCheck | null;
}

export function withDefaults(raw: Partial<Record<keyof Stored, unknown>>): Stored {
  const s = (raw.settings ?? {}) as Partial<Settings>;
  const network: Network = s.network === "mainnet" ? "mainnet" : "testnet";
  return {
    settings: {
      network,
      checkOnPaste: s.checkOnPaste ?? DEFAULT_SETTINGS.checkOnPaste,
      holdSend: s.holdSend ?? DEFAULT_SETTINGS.holdSend,
      clipboardCheck: s.clipboardCheck ?? DEFAULT_SETTINGS.clipboardCheck,
    },
    contacts: Array.isArray(raw.contacts) ? (raw.contacts as Contact[]).filter((c) => c && typeof c.account === "string") : [],
    stats: { checked: 0, stopped: 0, ...((raw.stats as Stats | undefined) ?? {}) },
    last: (raw.last as LastCheck | null | undefined) ?? null,
  };
}

/** Normalise and de-duplicate a contact list. */
export function addContact(list: Contact[], account: string, label?: string): Contact[] {
  const a = account.trim().toLowerCase();
  if (!a) return list;
  const rest = list.filter((c) => c.account !== a);
  const l = label?.trim();
  return [...rest, l ? { account: a, label: l } : { account: a }];
}

export function removeContact(list: Contact[], account: string): Contact[] {
  return list.filter((c) => c.account !== account);
}

/* ---------- chrome.storage wrappers (extension pages, content script, worker) ---------- */

export async function load(): Promise<Stored> {
  const raw = await chrome.storage.local.get(["settings", "contacts", "stats", "last"]);
  return withDefaults(raw);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const { settings } = await load();
  const next = { ...settings, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function saveContacts(contacts: Contact[]): Promise<void> {
  await chrome.storage.local.set({ contacts });
}
