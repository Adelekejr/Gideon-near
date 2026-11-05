import { parseHumanAmount } from "@gideon/core";

/** NEAR already cleared to SEND today, per sending account. In memory for this process. */
export interface SpendBook {
  day: string;
  by: Map<string, number>;
}

function dayOf(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function asNear(amount: string | undefined): number | null {
  if (amount == null) return null;
  const s = amount.trim();
  if (!s) return null;
  if (/^0(?:\.0+)?$/.test(s)) return 0;
  return parseHumanAmount(s);
}

/**
 * The cap for this call. The lower of the env cap and the call's cap wins, so a call can't raise it.
 * A value that isn't a number is returned as-is so the check refuses it instead of ignoring the cap.
 */
export function resolveDailyLimit(envVal?: string, argVal?: string): string | undefined {
  const e = envVal?.trim() || undefined;
  const a = argVal?.trim() || undefined;
  if (!e && !a) return undefined;
  const en = e ? asNear(e) : null;
  const an = a ? asNear(a) : null;
  if (e && en == null) return e;
  if (a && an == null) return a;
  const nums = [en, an].filter((n): n is number => n != null);
  const min = Math.min(...nums);
  if (an === min && a) return a;
  if (en === min && e) return e;
  return String(min);
}

export function freshBook(book: SpendBook, now: number): SpendBook {
  const day = dayOf(now);
  return book.day === day ? book : { day, by: new Map() };
}

/** NEAR already counted today for this account, as a decimal string. */
export function spentOf(book: SpendBook, from: string | undefined, now: number): string {
  const b = freshBook(book, now);
  if (!from?.trim()) return "0";
  const n = b.by.get(from.trim().toLowerCase()) ?? 0;
  return String(n);
}

/** Count a send that was cleared (SAFE). Repeating the same check counts again: that fails closed. */
export function noteSpend(book: SpendBook, from: string, amount: string, now: number): SpendBook {
  const b = freshBook(book, now);
  const n = asNear(amount);
  if (n == null || !from.trim()) return b;
  const k = from.trim().toLowerCase();
  b.by.set(k, (b.by.get(k) ?? 0) + n);
  return b;
}
