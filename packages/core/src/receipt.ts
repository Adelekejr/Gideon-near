import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import * as ed from "@noble/ed25519";
import type { CheckResult, Receipt } from "./types.js";

/** JSON with sorted keys, so the same result always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

export function resultDigest(result: Omit<CheckResult, "receipt"> | CheckResult): string {
  const { receipt: _r, ...rest } = result as CheckResult;
  return bytesToHex(sha256(utf8ToBytes(canonicalJson(rest))));
}

/** R12 — hash the result; sign it when an ed25519 secret key (64 hex) is given. */
export async function makeReceipt(result: Omit<CheckResult, "receipt">, secretKeyHex?: string): Promise<Receipt> {
  const digest = resultDigest(result);
  if (!secretKeyHex) return { sha256: digest };
  const sk = hexToBytes(secretKeyHex);
  const [signature, publicKey] = await Promise.all([ed.signAsync(hexToBytes(digest), sk), ed.getPublicKeyAsync(sk)]);
  return { sha256: digest, signature: bytesToHex(signature), publicKey: bytesToHex(publicKey) };
}

export interface ReceiptCheck { hashOk: boolean; signatureOk: boolean | null }

/** Recompute the hash and, if signed, verify the signature. */
export async function verifyReceipt(result: CheckResult): Promise<ReceiptCheck> {
  const hashOk = resultDigest(result) === result.receipt.sha256;
  if (!result.receipt.signature || !result.receipt.publicKey) return { hashOk, signatureOk: null };
  const signatureOk = await ed.verifyAsync(hexToBytes(result.receipt.signature), hexToBytes(result.receipt.sha256), hexToBytes(result.receipt.publicKey));
  return { hashOk, signatureOk };
}

export function newReceiptKey(): string {
  return bytesToHex(ed.utils.randomSecretKey());
}
