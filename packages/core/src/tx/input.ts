import type { Network } from "../types.js";
import { decodeTransactions, type TxAction, type TxRequest } from "./decode.js";

/*
 * Turns what a person or an agent has in hand into transactions Gideon can check: a wallet sign
 * link (MyNearWallet /sign?transactions=…, Meteor /connect/<network>/sign?transactions=…), the raw
 * base64 transactions themselves, a MyNearWallet sign-in link, or wallet-selector style JSON
 * ({ signerId, receiverId, actions: [{ type: "FunctionCall", params: {…} }] }).
 */

export interface ParsedRequest {
  transactions: TxRequest[];
  /** A sign-in that asks for a full-access key (MyNearWallet login without contract_id). */
  signIn?: { fullAccess: true; publicKey?: string; site?: string };
  /** Network the link points at, when it says (wallet host or path). */
  network?: Network;
  /** Where the request came from: the wallet link's host. */
  wallet?: string;
  /** The site that will get the answer (callback / success url host), when the link says. */
  site?: string;
  /** What kind of input it was. */
  source: "sign-link" | "login-link" | "base64" | "json";
}

const MNW_HOSTS = /(^|\.)mynearwallet\.com$|(^|\.)wallet\.near\.org$|(^|\.)wallet\.testnet\.near\.org$/;

function networkOfHost(host: string, path: string): Network | undefined {
  const m = /\/connect\/(mainnet|testnet)\//.exec(path);
  if (m) return m[1] as Network;
  if (/(^|\.)testnet\./.test(host) || /\.testnet\./.test(host)) return "testnet";
  if (MNW_HOSTS.test(host) || /meteorwallet\.app$/.test(host)) return "mainnet";
  return undefined;
}

function hostOf(u: string | null): string | undefined {
  if (!u) return undefined;
  try {
    return new URL(u).host || undefined;
  } catch {
    return undefined;
  }
}

/** A wallet link, or null when the text isn't a link Gideon knows. */
export function parseWalletUrl(text: string): ParsedRequest | null {
  let u: URL;
  try {
    u = new URL(text.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  const q = u.searchParams;
  const site = hostOf(q.get("callbackUrl") ?? q.get("callback_url") ?? q.get("success_url") ?? q.get("failure_url"));
  const network = networkOfHost(u.host, u.pathname);
  const base = { wallet: u.host, ...(network ? { network } : {}), ...(site ? { site } : {}) };
  const txs = q.get("transactions");
  if (txs && /\/sign\/?$/.test(u.pathname)) {
    return { ...base, transactions: readable(() => decodeTransactions(txs)), source: "sign-link" };
  }
  // MyNearWallet (and the old NEAR wallet) sign-in: with a public key but no contract_id, the
  // site gets a key that can do anything with the account.
  if (/\/login\/?$/.test(u.pathname) && MNW_HOSTS.test(u.host)) {
    const key = q.get("public_key");
    const contract = q.get("contract_id");
    if (key && !contract) return { ...base, transactions: [], signIn: { fullAccess: true, publicKey: key, ...(site ? { site } : {}) }, source: "login-link" };
    return { ...base, transactions: [], source: "login-link" };
  }
  return null;
}

/* ---------- wallet-selector JSON ---------- */

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : typeof v === "number" || typeof v === "bigint" ? String(v) : undefined);

function jsonAction(a: any): TxAction {
  const type = a?.type ?? Object.keys(a ?? {})[0];
  const p = a?.params ?? a?.[type] ?? a ?? {};
  const norm = String(type ?? "").replace(/^[a-z]/, (c) => c.toUpperCase());
  switch (norm) {
    case "CreateAccount": return { type: "CreateAccount" };
    case "DeployContract": return { type: "DeployContract", codeBytes: Number(p.code?.length ?? 0) };
    case "FunctionCall": {
      let args: unknown = p.args ?? {};
      if (typeof args === "string") {
        try { args = JSON.parse(args); } catch { /* keep as text */ }
      }
      return { type: "FunctionCall", methodName: String(p.methodName ?? p.method_name ?? ""), args, gas: str(p.gas) ?? "0", deposit: str(p.deposit) ?? "0" };
    }
    case "Transfer": return { type: "Transfer", deposit: str(p.deposit) ?? "0" };
    case "Stake": return { type: "Stake", stake: str(p.stake) ?? "0", publicKey: String(p.publicKey ?? "") };
    case "AddKey": {
      const ak = p.accessKey ?? p.access_key ?? {};
      const perm = ak.permission ?? "FullAccess";
      if (perm === "FullAccess" || perm?.fullAccess || perm?.gasKeyFullAccess) return { type: "AddKey", publicKey: String(p.publicKey ?? p.public_key ?? ""), fullAccess: true };
      const fc = perm.FunctionCall ?? perm.functionCall ?? perm;
      return {
        type: "AddKey", publicKey: String(p.publicKey ?? p.public_key ?? ""), fullAccess: false,
        receiverId: String(fc.receiverId ?? fc.receiver_id ?? ""), methodNames: Array.isArray(fc.methodNames ?? fc.method_names) ? (fc.methodNames ?? fc.method_names).map(String) : [],
        allowance: str(fc.allowance) ?? null,
      };
    }
    case "DeleteKey": return { type: "DeleteKey", publicKey: String(p.publicKey ?? p.public_key ?? "") };
    case "DeleteAccount": return { type: "DeleteAccount", beneficiaryId: String(p.beneficiaryId ?? p.beneficiary_id ?? "") };
    default: return { type: "Unknown", tag: -1 };
  }
}

function jsonTx(t: any): TxRequest {
  const receiverId = String(t?.receiverId ?? t?.receiver_id ?? "").trim().toLowerCase();
  if (!receiverId) throw new Error("a transaction needs a receiverId");
  const actions = (Array.isArray(t?.actions) ? t.actions : []).map(jsonAction);
  const signer = str(t?.signerId ?? t?.signer_id);
  const unknown = actions.findIndex((a: TxAction) => a.type === "Unknown");
  return {
    ...(signer ? { signerId: signer.trim().toLowerCase() } : {}),
    receiverId,
    actions: unknown >= 0 ? actions.slice(0, unknown + 1) : actions,
    ...(unknown >= 0 ? { partial: true } : {}),
  };
}

/** Transactions from JSON: one transaction, a list, or { transactions: [...] }. */
export function parseJsonTransactions(v: unknown): TxRequest[] {
  const list = Array.isArray(v) ? v : Array.isArray((v as any)?.transactions) ? (v as any).transactions : [v];
  if (!list.length) throw new Error("no transactions");
  if (list.length > 20) throw new Error("too many transactions");
  return list.map(jsonTx);
}

/**
 * Anything a person or agent pastes: a wallet sign or login link, raw base64 transactions
 * (comma-separated), or JSON. Throws with a plain message when it's none of these.
 */
export function parseTxRequest(input: string | object): ParsedRequest {
  if (typeof input !== "string") return { transactions: parseJsonTransactions(input), source: "json" };
  const text = input.trim();
  if (!text) throw new Error("Nothing to check: paste a sign link or a transaction.");
  if (/^https?:\/\//i.test(text)) {
    const r = parseWalletUrl(text);
    if (r) return r;
    throw new Error("This link isn't a wallet sign or sign-in request Gideon can read.");
  }
  if (/^[[{]/.test(text)) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new Error("This looks like JSON but doesn't parse.");
    }
    return { transactions: parseJsonTransactions(v), source: "json" };
  }
  return { transactions: readable(() => decodeTransactions(text)), source: "base64" };
}

/** Decoder messages in plain words. Anything not listed is shown as the decoder wrote it. */
export function friendlyTxError(msg: string): string {
  if (/string too long/.test(msg)) return "a text field in this request is longer than Gideon reads (over 4,096 bytes)";
  if (/unknown key type/.test(msg)) return "it uses a key type Gideon doesn't recognise";
  if (/unknown key permission/.test(msg)) return "it asks for a key permission Gideon doesn't recognise";
  return msg;
}

function readable<T>(run: () => T): T {
  try {
    return run();
  } catch (e) {
    throw new Error(`This isn't a NEAR transaction Gideon can read (${friendlyTxError(e instanceof Error ? e.message : String(e))}).`);
  }
}
