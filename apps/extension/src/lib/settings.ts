import { mergeContact, type CheckResult, type Contact } from "@gideon/core";
import type { NetworkMode } from "./network.js";
import type { DeviceSend } from "./sender.js";

/** Everything the extension keeps, all in chrome.storage.local on this device. */
export interface Settings {
  /** "auto" reads the network from the page (0.2.1+); "testnet" / "mainnet" are manual overrides. */
  networkMode: NetworkMode;
  /** Check recipient fields on paste and as you type. */
  checkOnPaste: boolean;
  /** Hold the page's Send / Withdraw button while the check says BLOCKED. */
  holdSend: boolean;
  /** Compare what you copied on the page with what got pasted (rule R9). */
  clipboardCheck: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  networkMode: "auto",
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
  /** Network checked on, and why ("testnet · from your wallet's account"). */
  net?: string;
  to: string;
  verdict: CheckResult["verdict"];
  couldNotCheck: boolean;
  title: string;
  at: string;
  /** The sender used for the check, if Gideon could tell. */
  from?: string;
}

export interface Stored {
  settings: Settings;
  contacts: Contact[];
  stats: Stats;
  last: LastCheck | null;
  /** Your own accounts: typed in the popup, or read in full from a wallet header before. */
  myAccounts: string[];
  /** Sends started from this device on wallet pages (recipient, network, time). */
  sends: DeviceSend[];
}

export function withDefaults(raw: Partial<Record<keyof Stored, unknown>>): Stored {
  const s = (raw.settings ?? {}) as Partial<Settings>;
  // 0.2.0 stored a manual `network` and had no Auto; 0.2.1 starts everyone on Auto once.
  const m = (s as { networkMode?: unknown }).networkMode;
  const networkMode: NetworkMode = m === "testnet" || m === "mainnet" ? m : "auto";
  return {
    settings: {
      networkMode,
      checkOnPaste: s.checkOnPaste ?? DEFAULT_SETTINGS.checkOnPaste,
      holdSend: s.holdSend ?? DEFAULT_SETTINGS.holdSend,
      clipboardCheck: s.clipboardCheck ?? DEFAULT_SETTINGS.clipboardCheck,
    },
    contacts: Array.isArray(raw.contacts) ? (raw.contacts as Contact[]).filter((c) => c && typeof c.account === "string") : [],
    stats: { checked: 0, stopped: 0, ...((raw.stats as Stats | undefined) ?? {}) },
    last: (raw.last as LastCheck | null | undefined) ?? null,
    myAccounts: Array.isArray(raw.myAccounts) ? (raw.myAccounts as unknown[]).filter((a): a is string => typeof a === "string") : [],
    sends: Array.isArray(raw.sends) ? (raw.sends as DeviceSend[]).filter((s) => s && typeof s.to === "string" && (s.network === "testnet" || s.network === "mainnet")) : [],
  };
}

/** Normalise and de-duplicate a contact list. A repeated label keeps the old account on `previous`. */
export function addContact(list: Contact[], account: string, label?: string): Contact[] {
  return mergeContact(list, account, label);
}

export function removeContact(list: Contact[], account: string): Contact[] {
  return list.filter((c) => c.account !== account);
}

/* ---------- chrome.storage wrappers (extension pages, content script, worker) ---------- */

export async function load(): Promise<Stored> {
  const raw = await chrome.storage.local.get(["settings", "contacts", "stats", "last", "myAccounts", "sends"]);
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
