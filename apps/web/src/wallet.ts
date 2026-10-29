// NEAR Connect (@hot-labs/near-connect): the wallet selector. Gideon only asks the
// connected wallet to sign a plain Transfer after the check; keys never leave the wallet.
import { NearConnector } from "@hot-labs/near-connect";
import { NETWORKS, type Network } from "@gideon/core";

export interface Connected { accountId: string; wallet: string }

export function connector(network: Network, onChange: (c: Connected | null) => void): NearConnector {
  const c = new NearConnector({
    network,
    features: { signAndSendTransaction: true },
    providers: { [network]: NETWORKS[network].rpcUrls },
    footerBranding: null,
    autoConnect: true,
  });
  c.on("wallet:signIn", (t) => onChange(t.accounts[0] ? { accountId: t.accounts[0].accountId, wallet: t.wallet.manifest.name } : null));
  c.on("wallet:signOut", () => onChange(null));
  c.getConnectedWallet().then(
    ({ wallet, accounts }) => accounts[0] && onChange({ accountId: accounts[0].accountId, wallet: wallet.manifest.name }),
    () => {},
  );
  return c;
}

/** Ask the wallet to sign and send one NEAR transfer. Returns the transaction hash. */
export async function sendNear(c: NearConnector, from: string, to: string, yocto: string): Promise<string | undefined> {
  const w = await c.wallet();
  const out = await w.signAndSendTransaction({ signerId: from, receiverId: to, actions: [{ type: "Transfer", params: { deposit: yocto } }] });
  return out?.transaction?.hash;
}
