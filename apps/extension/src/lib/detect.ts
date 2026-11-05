import { classify, oddCharacters, plainVersion, type AddressKind } from "@gideon/core";

/** Words that mark a field as "who you're sending to". */
const RECIPIENT = /(recipient|receiver|receiving|send[\s_-]*to|to[\s_-]*address|withdraw(al)?[\s_-]*address|wallet[\s_-]*address|deposit[\s_-]*address|destination|beneficiary|payee|account[\s_-]*id|near[\s_-]*account|\baddress\b)/i;
/** Words that mean it's some other kind of address or field. */
const NOT_RECIPIENT = /(e-?mail|street|city|postal|post code|postcode|zip|billing|shipping|ip[\s_-]*address|web[\s_-]*address|website|\burl\b|search|password|memo|\btag\b|amount|phone|coupon|promo|username|first[\s_-]*name|last[\s_-]*name|full[\s_-]*name)/i;

/**
 * Words that mark a field as holding a secret. Gideon never checks what's typed or pasted here,
 * so a private key or recovery phrase can't reach an address lookup.
 */
const SECRET = /(private[\s_-]*key|secret|seed|mnemonic|recovery|pass[\s_-]*phrase|backup[\s_-]*phrase|import[\s_-]*(wallet|account|key)|\bword[\s_#-]*\d+|one-time-code|current-password|new-password)/i;

/** Kinds that only ever appear when someone pasted an address or hash. */
const STRONG: AddressKind[] = ["near-implicit", "eth-implicit", "hex64-uppercase", "evm-tx-hash", "tron-address", "btc-address"];

const TEXT_TYPES = new Set(["", "text", "search", "url"]);

export type Field = HTMLInputElement | HTMLTextAreaElement;

export function isTextField(el: EventTarget | null): el is Field {
  if (!el || typeof (el as Element).tagName !== "string") return false;
  const e = el as Element;
  if (e.tagName === "TEXTAREA") return true;
  if (e.tagName !== "INPUT") return false;
  const t = ((e as HTMLInputElement).getAttribute("type") ?? "").toLowerCase();
  return TEXT_TYPES.has(t);
}

/** Text that describes a field: its own attributes and labels, then nearby text. */
export function describeField(el: Field): string {
  return [ownText(el), nearbyText(el)].filter(Boolean).join(" | ");
}

function ownText(el: Field): string {
  const parts: string[] = [];
  for (const a of ["name", "id", "placeholder", "aria-label", "autocomplete", "data-testid", "title"]) {
    const v = el.getAttribute(a);
    if (v) parts.push(v);
  }
  const doc = el.ownerDocument;
  const by = el.getAttribute("aria-labelledby");
  if (by) for (const id of by.split(/\s+/)) parts.push(doc.getElementById(id)?.textContent ?? "");
  if (el.id) {
    const lab = doc.querySelector(`label[for="${cssEscape(el.id)}"]`);
    if (lab) parts.push(lab.textContent ?? "");
  }
  const wrap = el.closest("label");
  if (wrap) parts.push(wrap.textContent ?? "");
  return parts.join(" | ").replace(/\s+/g, " ").trim();
}

/** A label-ish element just before the field or its wrapper (common in React UIs). */
function nearbyText(el: Field): string {
  const parts: string[] = [];
  let node: Element | null = el;
  for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
    const prev = node.previousElementSibling;
    if (prev && !prev.querySelector("input,textarea,select") && !/^(INPUT|TEXTAREA|SELECT)$/.test(prev.tagName) && (prev.textContent ?? "").length <= 60) {
      parts.push(prev.textContent ?? "");
      break;
    }
  }
  return parts.join(" | ").replace(/\s+/g, " ").trim();
}

function cssEscape(s: string): string {
  return s.replace(/["\\]/g, "\\$&");
}

/**
 * 64 hex characters (with or without 0x) is also how an Ethereum private key looks, so these are
 * only checked in a field labelled as a recipient, never in an unlabelled one.
 */
const KEY_SHAPED: AddressKind[] = ["near-implicit", "hex64-uppercase", "evm-tx-hash"];

/** Does this field look like it holds a private key, recovery phrase or password? */
export function isSecretField(el: Field): boolean {
  if (el.tagName === "INPUT" && (el as HTMLInputElement).type === "password") return true;
  const own = ownText(el);
  if (SECRET.test(own)) return true;
  if (RECIPIENT.test(own)) return false;
  return SECRET.test(nearbyText(el));
}

/** Does this field look like the recipient of a send? */
export function isRecipientField(el: Field): boolean {
  if (/^\s*to\s*$/i.test(el.getAttribute("aria-label") ?? "")) return true;
  const strong = /(recipient|withdraw|send to|deposit address|wallet address)/i;
  // The field's own name and label decide first; nearby text only when they say nothing.
  for (const text of [ownText(el), nearbyText(el)]) {
    if (!text) continue;
    if (NOT_RECIPIENT.test(text) && !strong.test(text)) return false;
    if (RECIPIENT.test(text)) return true;
  }
  return false;
}

/** A value that only an address or hash looks like: worth checking even in an unlabelled field. */
export function isStrongAddress(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 120 || /\s/.test(v)) return false;
  const c = classify(v);
  if (STRONG.includes(c.kind)) return true;
  return c.kind === "near-named" && /\.(near|testnet)$/i.test(v);
}

/**
 * Trim only ordinary spaces and line breaks. JavaScript's trim() also removes non-breaking spaces
 * and the invisible U+FEFF, which R15 must see.
 */
export function plainTrim(value: string): string {
  return value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
}

const NOTE = /\b(memo|note|message|reference|comment)\b/i;
const PAYEE_NAME = /\b(payee|recipient|beneficiary)\s*(name|label)\b/i;

/**
 * Memo and payee name in the same form as the recipient, when they're visible.
 * Read on the device for the instruction check. Not a recipient field, and never a secret.
 */
export function visibleNote(field: Field): { memo?: string; payee?: string } {
  const root = field.form ?? field.parentElement?.parentElement ?? null;
  if (!root) return {};
  let memo: string | undefined;
  let payee: string | undefined;
  for (const el of root.querySelectorAll("input, textarea")) {
    if (el === field || !isTextField(el) || isSecretField(el)) continue;
    const desc = describeField(el);
    const v = plainTrim((el as Field).value).slice(0, 280);
    if (!v) continue;
    if (PAYEE_NAME.test(desc)) { payee ??= v; continue; }
    if (isRecipientField(el)) continue;
    if (NOTE.test(desc)) memo ??= v;
  }
  return { ...(memo ? { memo } : {}), ...(payee ? { payee } : {}) };
}

/** Should a value in this field be checked? */
export function shouldCheck(el: Field, value: string): boolean {
  const raw = plainTrim(value);
  if (!raw || raw.length > 120) return false;
  // A fake letter, invisible character or hidden space hides an address: judge what it imitates.
  const v = oddCharacters(raw).length ? plainVersion(raw) : raw.trim();
  if (!v || v.length > 120 || /\s/.test(v)) return false;
  if (isSecretField(el)) return false;
  if (isStrongAddress(v)) return !KEY_SHAPED.includes(classify(v).kind) || isRecipientField(el);
  if (!isRecipientField(el)) return false;
  const k = classify(v).kind;
  return k !== "empty" && v.length >= 2;
}

const SEND_WORDS = /^(send|withdraw|transfer|confirm|continue|next|submit|pay|review)\b/i;

/** The Send / Withdraw buttons that belong with a field: in its form, or nearby. */
export function findSendButtons(el: Field): HTMLElement[] {
  const scope: ParentNode = el.form ?? nearestContainer(el);
  const all = Array.from(scope.querySelectorAll<HTMLElement>('button, input[type="submit"], [role="button"]'));
  return all.filter((b) => {
    const label = (b.tagName === "INPUT" ? (b as HTMLInputElement).value : b.textContent ?? "").trim();
    return SEND_WORDS.test(label) || (b.getAttribute("type") === "submit" && !!el.form);
  });
}

function nearestContainer(el: Element): ParentNode {
  let node: Element | null = el.parentElement;
  for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
    if (node.querySelector('button, input[type="submit"], [role="button"]')) return node;
  }
  return el.ownerDocument;
}
