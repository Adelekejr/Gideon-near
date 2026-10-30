/*
 * Reads NEAR transactions from their borsh bytes, the way wallets pass them in a sign link
 * (MyNearWallet and Meteor: `?transactions=<base64>,<base64>`). Read-only: Gideon never builds,
 * signs or sends anything. Layout from nearcore (core/primitives/src/transaction.rs) and
 * near-api-js (packages/transactions/src/schema.ts).
 */

export interface TxKey {
  /** "ed25519:<base58>" or "secp256k1:<base58>". */
  publicKey: string;
}

export type TxAction =
  | { type: "CreateAccount" }
  | { type: "DeployContract"; codeBytes: number }
  | { type: "FunctionCall"; methodName: string; args: unknown; argsBase64?: string; gas: string; deposit: string }
  | { type: "Transfer"; deposit: string }
  | { type: "Stake"; stake: string; publicKey: string }
  | { type: "AddKey"; publicKey: string; fullAccess: boolean; receiverId?: string; methodNames?: string[]; allowance?: string | null }
  | { type: "DeleteKey"; publicKey: string }
  | { type: "DeleteAccount"; beneficiaryId: string }
  /** An action kind Gideon doesn't read (delegate, global contracts…). Everything after it is unknown too. */
  | { type: "Unknown"; tag: number };

export interface TxRequest {
  signerId?: string;
  receiverId: string;
  actions: TxAction[];
  publicKey?: string;
  nonce?: string;
  /** True when part of the bytes couldn't be read: the request may do more than is listed. */
  partial?: boolean;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = "1" + s;
  }
  return s;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.trim().replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length < 8) throw new Error("not base64");
  const pad = clean.length % 4 ? clean + "=".repeat(4 - (clean.length % 4)) : clean;
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

class Reader {
  i = 0;
  constructor(private b: Uint8Array) {}
  left(): number {
    return this.b.length - this.i;
  }
  need(n: number): void {
    if (n < 0 || this.i + n > this.b.length) throw new Error("ran out of bytes");
  }
  u8(): number {
    this.need(1);
    return this.b[this.i++]!;
  }
  u16(): number {
    return this.u8() | (this.u8() << 8);
  }
  u32(): number {
    this.need(4);
    const v = this.b[this.i]! | (this.b[this.i + 1]! << 8) | (this.b[this.i + 2]! << 16) | (this.b[this.i + 3]! << 24);
    this.i += 4;
    return v >>> 0;
  }
  uint(bytes: number): bigint {
    this.need(bytes);
    let v = 0n;
    for (let k = bytes - 1; k >= 0; k--) v = (v << 8n) | BigInt(this.b[this.i + k]!);
    this.i += bytes;
    return v;
  }
  bytes(n: number): Uint8Array {
    this.need(n);
    const out = this.b.slice(this.i, this.i + n);
    this.i += n;
    return out;
  }
  vecBytes(): Uint8Array {
    return this.bytes(this.u32());
  }
  str(): string {
    const n = this.u32();
    if (n > 4096) throw new Error("string too long");
    return new TextDecoder("utf-8", { fatal: true }).decode(this.bytes(n));
  }
  publicKey(): string {
    const t = this.u8();
    if (t === 0) return `ed25519:${base58(this.bytes(32))}`;
    if (t === 1) return `secp256k1:${base58(this.bytes(64))}`;
    throw new Error(`unknown key type ${t}`);
  }
}

function permission(r: Reader): Pick<Extract<TxAction, { type: "AddKey" }>, "fullAccess" | "receiverId" | "methodNames" | "allowance"> {
  const p = r.u8();
  const functionCall = () => {
    const allowance = r.u8() === 1 ? r.uint(16).toString() : null;
    const receiverId = r.str();
    const n = r.u32();
    if (n > 256) throw new Error("too many method names");
    const methodNames = Array.from({ length: n }, () => r.str());
    return { fullAccess: false, receiverId, methodNames, allowance };
  };
  const gasKeyInfo = () => {
    r.uint(16); // balance
    r.u16(); // num_nonces
  };
  if (p === 0) return functionCall();
  if (p === 1) return { fullAccess: true };
  if (p === 2) {
    gasKeyInfo();
    return functionCall();
  }
  if (p === 3) {
    gasKeyInfo();
    return { fullAccess: true };
  }
  throw new Error(`unknown key permission ${p}`);
}

function argsOf(bytes: Uint8Array): { args: unknown; argsBase64?: string } {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { args: text.length ? JSON.parse(text) : {} };
  } catch {
    return { args: null, argsBase64: toBase64(bytes) };
  }
}

function action(r: Reader): TxAction {
  const tag = r.u8();
  switch (tag) {
    case 0:
      return { type: "CreateAccount" };
    case 1:
      return { type: "DeployContract", codeBytes: r.vecBytes().length };
    case 2: {
      const methodName = r.str();
      const a = argsOf(r.vecBytes());
      const gas = r.uint(8).toString();
      const deposit = r.uint(16).toString();
      return { type: "FunctionCall", methodName, ...a, gas, deposit };
    }
    case 3:
      return { type: "Transfer", deposit: r.uint(16).toString() };
    case 4: {
      const stake = r.uint(16).toString();
      return { type: "Stake", stake, publicKey: r.publicKey() };
    }
    case 5: {
      const publicKey = r.publicKey();
      r.uint(8); // access key nonce
      return { type: "AddKey", publicKey, ...permission(r) };
    }
    case 6:
      return { type: "DeleteKey", publicKey: r.publicKey() };
    case 7:
      return { type: "DeleteAccount", beneficiaryId: r.str() };
    default:
      return { type: "Unknown", tag };
  }
}

function body(r: Reader): TxRequest {
  const signerId = r.str();
  const publicKey = r.publicKey();
  const nonce = r.uint(8).toString();
  const receiverId = r.str();
  r.bytes(32); // block hash
  const n = r.u32();
  if (n > 100) throw new Error("too many actions");
  const actions: TxAction[] = [];
  let partial = false;
  for (let k = 0; k < n; k++) {
    const a = action(r);
    actions.push(a);
    if (a.type === "Unknown") {
      partial = true;
      break;
    }
  }
  return { signerId, publicKey, nonce, receiverId, actions, ...(partial ? { partial: true } : {}) };
}

/**
 * One transaction from its borsh bytes: Transaction (V0), TransactionV1 (leading 1, trailing
 * priority fee) or a SignedTransaction (either, plus a 65-byte signature). Throws on bytes that
 * aren't a NEAR transaction.
 */
export function decodeTransaction(bytes: Uint8Array): TxRequest {
  // V0 starts with the signer's name length (2 to 64), so a leading 1 can only be TransactionV1.
  const v1 = bytes[0] === 1;
  const r = new Reader(v1 ? bytes.subarray(1) : bytes);
  const tx = body(r);
  if (tx.partial) return tx;
  if (v1) r.uint(8); // priority fee
  const rest = r.left();
  if (rest !== 0 && rest !== 65) throw new Error("extra bytes after the transaction");
  if (!/^[a-z0-9._-]{2,64}$/.test(tx.signerId ?? "") || !/^[a-z0-9._-]{2,64}$/.test(tx.receiverId)) throw new Error("not a NEAR account name");
  return tx;
}

/** Comma-separated base64 transactions, as in a wallet sign link. */
export function decodeTransactions(text: string): TxRequest[] {
  const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error("no transactions");
  if (parts.length > 20) throw new Error("too many transactions");
  return parts.map((p) => decodeTransaction(fromBase64(decodeURIComponent(p))));
}

/* ---------- writing, only for tests and the unsigned demo link ---------- */

class Writer {
  parts: number[] = [];
  u8(v: number) {
    this.parts.push(v & 255);
  }
  u32(v: number) {
    for (let k = 0; k < 4; k++) this.parts.push((v >>> (8 * k)) & 255);
  }
  uint(v: bigint | string, bytes: number) {
    let x = BigInt(v);
    for (let k = 0; k < bytes; k++) {
      this.parts.push(Number(x & 255n));
      x >>= 8n;
    }
  }
  raw(b: Uint8Array) {
    for (const x of b) this.parts.push(x);
  }
  str(s: string) {
    const b = new TextEncoder().encode(s);
    this.u32(b.length);
    this.raw(b);
  }
}

function unbase58(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("bad base58");
    n = n * 58n + BigInt(i);
  }
  const out: number[] = [];
  while (n > 0n) {
    out.unshift(Number(n & 255n));
    n >>= 8n;
  }
  for (const c of s) {
    if (c !== "1") break;
    out.unshift(0);
  }
  return new Uint8Array(out);
}

function writeKey(w: Writer, key: string) {
  const [kind, data] = key.split(":");
  const bytes = unbase58(data ?? "");
  const len = kind === "secp256k1" ? 64 : 32;
  const padded = new Uint8Array(len);
  padded.set(bytes.slice(-len), len - Math.min(len, bytes.length));
  w.u8(kind === "secp256k1" ? 1 : 0);
  w.raw(padded);
}

/** Borsh bytes of an unsigned Transaction (V0). For tests and building a demo sign link only. */
export function encodeTransaction(tx: Required<Pick<TxRequest, "signerId" | "publicKey" | "receiverId" | "actions">> & { nonce?: string; blockHash?: Uint8Array }): Uint8Array {
  const w = new Writer();
  w.str(tx.signerId);
  writeKey(w, tx.publicKey);
  w.uint(tx.nonce ?? "1", 8);
  w.str(tx.receiverId);
  w.raw(tx.blockHash ?? new Uint8Array(32));
  w.u32(tx.actions.length);
  for (const a of tx.actions) {
    switch (a.type) {
      case "CreateAccount": w.u8(0); break;
      case "DeployContract": w.u8(1); w.u32(0); break;
      case "FunctionCall": {
        w.u8(2);
        w.str(a.methodName);
        const args = new TextEncoder().encode(JSON.stringify(a.args ?? {}));
        w.u32(args.length);
        w.raw(args);
        w.uint(a.gas, 8);
        w.uint(a.deposit, 16);
        break;
      }
      case "Transfer": w.u8(3); w.uint(a.deposit, 16); break;
      case "Stake": w.u8(4); w.uint(a.stake, 16); writeKey(w, a.publicKey); break;
      case "AddKey":
        w.u8(5);
        writeKey(w, a.publicKey);
        w.uint(0n, 8);
        if (a.fullAccess) w.u8(1);
        else {
          w.u8(0);
          if (a.allowance) { w.u8(1); w.uint(a.allowance, 16); } else w.u8(0);
          w.str(a.receiverId ?? "");
          w.u32(a.methodNames?.length ?? 0);
          for (const m of a.methodNames ?? []) w.str(m);
        }
        break;
      case "DeleteKey": w.u8(6); writeKey(w, a.publicKey); break;
      case "DeleteAccount": w.u8(7); w.str(a.beneficiaryId); break;
      case "Unknown": w.u8(a.tag); break;
    }
  }
  return new Uint8Array(w.parts);
}
