import type { Ctx } from "../context.js";
import type { ForeignTx } from "../types.js";
import { explorerTxUrl } from "../networks.js";
import { yoctoToNear } from "../context.js";
import { couldNotCheck, f, skipped, short, type RuleResult } from "./util.js";

/** R2 — a transaction hash pasted as an account (Tron, Ethereum, Bitcoin, NEAR). */
export async function r02PastedHash(ctx: Ctx): Promise<RuleResult> {
  const { c, input } = ctx;
  const net = input.network;

  if (c.kind === "evm-tx-hash") {
    const r = await ctx.ask("ethereum", c.normalized, (s) => s.ethTx(c.normalized));
    if (r.ok && r.value) return hashFound(r.value, c.normalized);
    return skipped("R2", "EVM transaction-hash format; R1 already blocks it.");
  }

  if (c.kind === "base58-32") {
    const r = await ctx.ask(`nearblocks-${net}`, `tx:${c.normalized}`, (s) => s.nearTx(net, c.normalized));
    if (r.ok && r.value) {
      return f("R2", "BLOCKED", "NEAR_TX_HASH", "This is a NEAR transaction hash, not an account",
        `You pasted the ID of a NEAR transaction from ${r.value.signer} to ${r.value.receiver}. It isn't an address.`,
        { fix: ["Copy the receiver's account name (or 64-character account) instead of the transaction ID."],
          evidence: [{ label: "NEAR transaction", value: short(r.value.hash), url: explorerTxUrl(net, r.value.hash) }] });
    }
    return skipped("R2", "Not a NEAR transaction hash on this network; R1 already blocks the format.");
  }

  if (c.kind !== "near-implicit" && c.kind !== "hex64-uppercase") return skipped("R2", "Only 64-hex inputs can be a pasted hash.");

  const h = c.normalized;
  const acc = await ctx.ask(`rpc-${net}`, `account:${h}`, (s) => s.viewAccount(net, h));
  if (acc.ok && acc.value) {
    return f("R2", "PASS", "REAL_ACCOUNT", "A real NEAR account, not a pasted hash",
      `This account exists on NEAR ${net} with ${yoctoToNear(acc.value.amountYocto)} NEAR.`);
  }

  const [tron, eth, btc] = await Promise.all([
    ctx.ask("tron", h, (s) => s.tronTx(h)),
    ctx.ask("ethereum", `0x${h}`, (s) => s.ethTx(`0x${h}`)),
    ctx.ask("bitcoin", h, (s) => s.btcTx(h)),
  ]);
  for (const r of [tron, eth, btc]) if (r.ok && r.value) return hashFound(r.value, h);

  const failed = [tron.ok ? null : `Tron: ${tron.error}`, eth.ok ? null : `Ethereum: ${eth.error}`, btc.ok ? null : `Bitcoin: ${btc.error}`].filter(Boolean);
  if (failed.length) return couldNotCheck("R2", "whether this is a pasted transaction hash", failed.join("; "));
  return f("R2", "PASS", "NOT_A_KNOWN_HASH", "Not a known transaction hash",
    "No Tron, Ethereum or Bitcoin transaction has this ID.");
}

function hashFound(tx: ForeignTx, pasted: string) {
  return f("R2", "BLOCKED", "TX_HASH_AS_ACCOUNT", `This is a ${tx.chain} transaction hash, not an account`,
    `It looks like a NEAR account, so a wallet would accept it. But it's the ID of a ${tx.chain} transaction (${tx.summary}). Nobody holds the key to a NEAR account with this name, so anything sent there is gone for good.`,
    { fix: ["Don't send. Nothing has left your wallet.", "On the receiving app, open Deposit and choose NEAR (NEAR Protocol) as the network.", "Copy the deposit address shown there and paste it here again."],
      evidence: [{ label: `${tx.chain} transaction`, value: short(pasted), url: tx.explorerUrl }] });
}
