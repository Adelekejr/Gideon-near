export type Network = "mainnet" | "testnet";

/** Per-rule outcome. COULD_NOT_CHECK means a data source failed: it never counts as safe. */
export type Status = "BLOCKED" | "ATTENTION" | "PASS" | "COULD_NOT_CHECK" | "SKIPPED";

/** Overall answer. SAFE only when every rule that applied ran with real data and passed. */
export type Verdict = "BLOCKED" | "ATTENTION" | "SAFE";

export type RuleId =
  | "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8" | "R9" | "R10" | "R11" | "R12";

export type Destination = "wallet" | "exchange" | "intents" | "unknown";

export interface Asset {
  /** Display symbol, e.g. "NEAR", "wNEAR", "USDC". */
  symbol: string;
  /** NEP-141 contract. Omit for native NEAR. */
  contract?: string;
}

export interface Contact {
  account: string;
  label?: string;
}

export interface CheckInput {
  /** What the user pasted as the recipient. */
  to: string;
  network: Network;
  /** Defaults to native NEAR. */
  asset?: Asset;
  /** Human amount, e.g. "25" or "0.5". Optional. */
  amount?: string;
  destination?: Destination;
  /** Exchange id from data/exchanges.json when destination is "exchange". */
  exchange?: string;
  /** Sender account, used to read recent history for lookalike checks (R7). */
  from?: string;
  /** User's saved contacts (R7). */
  addressBook?: Contact[];
  /** What the user copied, if known (R9, extension). */
  clipboard?: { copied: string };
}

export interface CheckOptions {
  /** Fixed clock for tests and receipts. Defaults to Date.now(). */
  now?: number;
  /** ed25519 secret key (64 hex chars). When set, the receipt is signed (R12). */
  receiptKey?: string;
}

export interface Evidence {
  label: string;
  value: string;
  url?: string;
}

export interface Finding {
  rule: RuleId;
  /** Stable machine code, e.g. "TX_HASH_AS_ACCOUNT". */
  code: string;
  status: Status;
  title: string;
  detail: string;
  fix?: string[];
  evidence?: Evidence[];
}

export type AddressKind =
  | "near-named"
  | "near-implicit"
  | "eth-implicit"
  | "hex64-uppercase"
  | "evm-tx-hash"
  | "tron-address"
  | "btc-address"
  | "base58-32"
  | "empty"
  | "invalid";

export interface Classification {
  kind: AddressKind;
  /** Lowercased/trimmed form used for lookups. */
  normalized: string;
  label: string;
}

export interface CheckResult {
  engine: string;
  input: CheckInput & { asset: Asset; destination: Destination };
  classification: Classification;
  verdict: Verdict;
  headline: Finding | null;
  findings: Finding[];
  /** Each source the engine asked, and whether it answered. */
  sources: SourceCall[];
  checkedAt: string;
  ms: number;
  /** R12: sha256 of the canonical result, optionally signed with ed25519. */
  receipt: Receipt;
}

export interface Receipt {
  /** sha256 (hex) over the canonical JSON of the result without the receipt. */
  sha256: string;
  /** ed25519 signature (hex) of the sha256 bytes, when a receipt key was given. */
  signature?: string;
  publicKey?: string;
}

export interface SourceCall {
  source: string;
  ok: boolean;
  ms: number;
  error?: string;
}

/* ---------- facts the engine asks the data sources for ---------- */

export interface AccountInfo {
  amountYocto: string;
  codeHash: string;
  storageUsage: number;
}

export interface ForeignTx {
  chain: "Tron" | "Ethereum" | "Bitcoin";
  hash: string;
  summary: string;
  explorerUrl: string;
}

export interface FtMetadata {
  name: string;
  symbol: string;
  decimals: number;
}

/** Subset of 1Click GET /v0/status (schema: defuse-protocol/one-click-sdk-typescript). */
export interface OneClickStatus {
  status: string;
  updatedAt?: string;
  quoteResponse?: {
    quoteRequest?: {
      originAsset?: string;
      destinationAsset?: string;
      amount?: string;
      deadline?: string;
      recipient?: string;
      refundTo?: string;
      depositType?: string;
      swapType?: string;
    };
    quote?: {
      depositAddress?: string;
      amountIn?: string;
      amountInFormatted?: string;
      minAmountIn?: string;
      deadline?: string;
      timeWhenInactive?: string;
    };
  };
}

export interface NearTx {
  hash: string;
  signer: string;
  receiver: string;
  blockTimestampNs?: string;
}

export interface Transfer {
  hash: string;
  signer: string;
  receiver: string;
  /** Native NEAR attached, in yocto (approximate; NearBlocks returns floats). */
  depositYocto: number;
  blockTimestampNs?: string;
}

/**
 * Every method either resolves with data, resolves with null for "doesn't exist",
 * or throws when the source couldn't be reached. Throwing becomes COULD_NOT_CHECK.
 */
export interface Sources {
  viewAccount(network: Network, accountId: string): Promise<AccountInfo | null>;
  tronTx(hash: string): Promise<ForeignTx | null>;
  ethTx(hash0x: string): Promise<ForeignTx | null>;
  btcTx(hash: string): Promise<ForeignTx | null>;
  ftMetadata(network: Network, contract: string): Promise<FtMetadata | null>;
  storageRegistered(network: Network, contract: string, accountId: string): Promise<boolean>;
  oneClickStatus(depositAddress: string): Promise<OneClickStatus | null>;
  recentTransfers(network: Network, accountId: string): Promise<Transfer[]>;
  nearTx(network: Network, hash: string): Promise<NearTx | null>;
}
