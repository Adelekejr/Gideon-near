export type Network = "mainnet" | "testnet";

/** Per-rule outcome. COULD_NOT_CHECK means a data source failed: it never counts as safe. */
export type Status = "BLOCKED" | "ATTENTION" | "PASS" | "COULD_NOT_CHECK" | "SKIPPED";

/** Overall answer. SAFE only when every rule that applied ran with real data and passed. */
export type Verdict = "BLOCKED" | "ATTENTION" | "SAFE";

export type RuleId =
  | "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8" | "R9" | "R10" | "R11" | "R12" | "R13" | "R14" | "R15" | "R16" | "R17" | "R18"
  /** Transaction checks (checkTransaction): full access, new or drainer-linked contract, whole balance, NFT control. */
  | "T1" | "T2" | "T3" | "T4" | "T5" | "T6";

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
  /**
   * Accounts you sent to from this device on this network (the extension remembers sends you
   * made on wallet pages). They count as past recipients even when the sender isn't known
   * or the indexer hasn't caught up (R7, R13).
   */
  deviceSends?: string[];
  /** User's saved contacts (R7). */
  addressBook?: Contact[];
  /**
   * The network the wallet page seems to be on, when that isn't certain and differs from
   * \`network\` (the extension sets it). R16 then looks for the same name on that network.
   */
  walletNetwork?: Network;
  /** What the user copied, if known (R9, extension). */
  clipboard?: { copied: string };
}

export interface CheckOptions {
  /** Fixed clock for tests and receipts. Defaults to Date.now(). */
  now?: number;
  /** ed25519 secret key (64 hex chars). When set, the receipt is signed (R12). */
  receiptKey?: string;
  /** Community flag registry contract for R10. Overrides the network default; "" turns R10 off. */
  flagRegistry?: string;
  /**
   * Hard limit for the whole check, in ms. A rule still waiting when it runs out reports
   * COULD_NOT_CHECK (never PASS), so a slow source can't hang a check or turn into "safe". Off by default.
   */
  deadlineMs?: number;
  /** Limit for any one source lookup, in ms (covers endpoint fallbacks too). Off by default. */
  sourceTimeoutMs?: number;
  /**
   * Total time info-only lookups (creation date, archival dating) may add after the account is
   * found. When it runs out the date reads "unavailable"; the verdict never waits on it. Defaults to sourceTimeoutMs.
   */
  optionalBudgetMs?: number;
  /**
   * Limit for the sender's history lookups (recent transfers, "sent here before?"), in ms. These
   * are info-only: when they run out, lookalikes are compared with saved contacts only and the
   * first-send note is left out. Defaults to sourceTimeoutMs.
   */
  historyTimeoutMs?: number;
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
  /**
   * What Gideon read about the recipient account itself (null when the input isn't a NEAR account).
   * `exists: null` means the lookup failed, which never counts as "exists".
   */
  account: AccountFacts | null;
  /** R12: sha256 of the canonical result, optionally signed with ed25519. */
  receipt: Receipt;
}

export interface AccountFacts {
  id: string;
  network: Network;
  /** true = found by a live view_account call, false = not found, null = couldn't check. */
  exists: boolean | null;
  /** Native balance in NEAR, when it exists. */
  balanceNear?: string;
  /** True when the account runs contract code. */
  contract?: boolean;
  /** When the account was created (ISO date), if a free indexer answered. */
  createdAt?: string;
  /**
   * How sure Gideon is about the creation date:
   * "known" = indexer date; "after-indexer" = exists on chain but newer than the indexer's data;
   * "unavailable" = no date (indexer down, or no record and no sign it's behind).
   */
  created?: "known" | "after-indexer" | "unavailable";
  /** Blocks between the indexer's last processed block and the live chain, when both are known. */
  indexerLagBlocks?: number;
  /** The indexer's last processed block, when known. */
  indexedHeight?: number;
  /**
   * For accounts newer than the indexer: whole days since creation, read from archival chain
   * state (0 = within 24 hours). 7 means "already existed 7 days ago" (not new).
   */
  chainAgeDays?: number;
  /** One plain sentence for the UI, e.g. "Account exists on NEAR testnet. Created 30 Apr 2022. Holds 180.65 NEAR." */
  summary: string;
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
  /** Info-only lookup (e.g. creation date). Its failure never affects the verdict. */
  optional?: boolean;
}

/* ---------- facts the engine asks the data sources for ---------- */

export interface AccountInfo {
  amountYocto: string;
  codeHash: string;
  storageUsage: number;
  /** Chain height the RPC answered at (used to tell when an indexer is behind). */
  blockHeight?: number;
}

/** What an indexer knows about when an account was created. */
export interface AccountCreation {
  /** Creation time (ms since epoch), or null when the indexer has no date. */
  createdMs: number | null;
  /** True when the indexer has a row for this account at all (even without a date). */
  indexed: boolean;
  /** The last block the indexer has processed, when it says. */
  indexedHeight?: number | null;
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
  /** `get_flags` view call on the registry. null = the registry account or contract doesn't exist. */
  communityFlags(network: Network, registry: string, accountId: string): Promise<CommunityFlag[] | null>;
  /**
   * Optional: when the account was created, from an indexer. A bare number is ms since epoch;
   * null = unknown. Existence always comes from viewAccount; the date only feeds R11 (account age).
   */
  accountCreated?(network: Network, accountId: string): Promise<number | AccountCreation | null>;
  /**
   * Optional: did the account already exist at this time (ms since epoch)? Read from archival
   * RPC state. Used only to date accounts the indexer hasn't caught up with. null = unknown.
   */
  accountExistedAt?(network: Network, accountId: string, atMs: number): Promise<boolean | null>;
  /**
   * Optional: did the account exist in the chain's first block (genesis)? Read from archival RPC.
   * Genesis accounts (e.g. illia.near) have no creation transaction, so the indexer has no date. null = unknown.
   */
  accountAtGenesis?(network: Network, accountId: string): Promise<boolean | null>;
  /**
   * Optional: how many transactions `from` has signed with `to` as the receiver (any time). Feeds
   * R13 (first send). Native NEAR sends and calls only: token transfers go to the token contract.
   */
  sentCount?(network: Network, from: string, to: string): Promise<number>;
  /**
   * Optional (R18, drained-wallet check): the account's newest transactions where it really
   * received something (newest first), plus how many such transactions it has in total.
   */
  inboundTxs?(network: Network, accountId: string, limit: number): Promise<{ total: number; txs: ChainTx[] }>;
  /**
   * Optional (R18): transactions the account signed at or before this block height, newest first.
   */
  signedTxsUpTo?(network: Network, accountId: string, blockHeight: number, limit: number): Promise<ChainTx[]>;
  /** Optional (T2, transaction check): how many transactions the account has in total (as signer or receiver). */
  txCount?(network: Network, accountId: string): Promise<number>;
  /** Optional (T3): `ft_balance_of` on the token contract, as a raw integer string. null = no such token contract. */
  ftBalance?(network: Network, contract: string, accountId: string): Promise<string | null>;
  /** Optional (T4): `nft_token` on the collection. null = no such token. */
  nftToken?(network: Network, contract: string, tokenId: string): Promise<{ title?: string; ownerId?: string } | null>;
  /** Optional (account health): the account's access keys now, from RPC view_access_key_list. null = no such account. */
  accessKeys?(network: Network, accountId: string): Promise<AccessKeyEntry[] | null>;
  /** Optional (account health): when each key was added and removed, from an indexer (newest first). */
  keyRecords?(network: Network, accountId: string): Promise<KeyRecord[]>;
  /** Optional (account health): these transactions, with signing key and actions. */
  txsByHash?(network: Network, hashes: string[]): Promise<ChainTx[]>;
  /** Optional (account health): the newest transactions the account signed, newest first. */
  signedTxs?(network: Network, accountId: string, limit: number): Promise<ChainTx[]>;
  /** Optional (account health): the time of a block (ms since epoch), from archival RPC. null = no such block. */
  blockTimeMs?(network: Network, height: number): Promise<number | null>;
}

/** One access key as the chain has it now (RPC view_access_key_list). */
export interface AccessKeyEntry {
  publicKey: string;
  /** Raw nonce, as a decimal string. New keys start at (block height at the add) × 10^6. */
  nonce: string;
  permission: "FullAccess" | { receiverId: string; methodNames: string[]; /** null = no limit */ allowanceYocto: string | null };
}

/** An indexer's row for one key of an account: when it was added and (if so) removed. */
export interface KeyRecord {
  publicKey: string;
  fullAccess: boolean;
  createdTx: string | null;
  createdMs: number | null;
  deletedTx: string | null;
  deletedMs: number | null;
}

/** One action of a NEAR transaction, as much as R18 needs. */
export type ChainAction =
  | { kind: "transfer"; depositYocto: string }
  | { kind: "addKey"; publicKey: string; fullAccess: boolean }
  | { kind: "deleteKey"; publicKey: string }
  | { kind: "other" };

/** A NEAR transaction with its signing key and actions (R18). */
export interface ChainTx {
  hash: string;
  signer: string;
  /** The public key that signed it. */
  signerKey: string;
  receiver: string;
  timestampMs: number;
  blockHeight: number;
  actions: ChainAction[];
}

/** One report in the community flag registry (contracts/flag-registry). */
export interface CommunityFlag {
  reporter: string;
  reason: string;
  at_ms: number;
}
