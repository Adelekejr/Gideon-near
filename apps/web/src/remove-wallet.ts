// NEAR Wallet Selector (@near-wallet-selector) for the account page's "Remove key in my wallet".
// Loaded only when someone presses that button, so the rest of the site stays small.
//
// How sign-in works here: Gideon opens the selector with no contractId, so it asks the wallet
// for the account name only and does not ask it to add any key. The one thing Gideon ever asks
// the wallet to sign is a single DeleteKey on the account that was checked; the wallet shows it
// and the person approves or rejects it there. Gideon never sees or holds a key.
import type { Network } from "@gideon/core";
import type { WalletModuleFactory } from "@near-wallet-selector/core";

export interface WalletState { accountId: string | null; wallet: string | null }
export interface RemoveWallet {
  state(): WalletState;
  /** Open the wallet list. */
  connect(): void;
  /** Sign out, then open the wallet list again. */
  switchWallet(): Promise<void>;
  /** Ask the connected wallet to sign and send one DeleteKey on `account`. Browser wallets leave the page and come back to `callbackUrl`. */
  removeKey(account: string, publicKey: string, callbackUrl: string): Promise<string | undefined>;
}

const cache = new Map<Network, Promise<RemoveWallet>>();

/** Wallets that can sign a DeleteKey with no paid projectId. WalletConnect and Unity are left out: they need a Reown projectId. */
async function modules() {
  await import("./wallet-shims");
  const [m, ma, mnw, here, hot, sender, nightly, bitte, intear, okx, c98, math, welldone, nar, nmw, ledger, xdefi] = await Promise.all([
    import("@near-wallet-selector/meteor-wallet"), import("@near-wallet-selector/meteor-wallet-app"),
    import("@near-wallet-selector/my-near-wallet"), import("@near-wallet-selector/here-wallet"),
    import("@near-wallet-selector/hot-wallet"), import("@near-wallet-selector/sender"),
    import("@near-wallet-selector/nightly"), import("@near-wallet-selector/bitte-wallet"),
    import("@near-wallet-selector/intear-wallet"), import("@near-wallet-selector/okx-wallet"),
    import("@near-wallet-selector/coin98-wallet"), import("@near-wallet-selector/math-wallet"),
    import("@near-wallet-selector/welldone-wallet"), import("@near-wallet-selector/narwallets"),
    import("@near-wallet-selector/near-mobile-wallet"), import("@near-wallet-selector/ledger"),
    import("@near-wallet-selector/xdefi"),
  ]);
  return ([
    m.setupMeteorWallet(), ma.setupMeteorWalletApp({ contractId: "" }), mnw.setupMyNearWallet(), hot.setupHotWallet(),
    here.setupHereWallet(), sender.setupSender(), nightly.setupNightly(), bitte.setupBitteWallet(), intear.setupIntearWallet(),
    okx.setupOKXWallet(), c98.setupCoin98Wallet(), math.setupMathWallet(), welldone.setupWelldoneWallet(), nar.setupNarwallets(),
    nmw.setupNearMobileWallet(), ledger.setupLedger(), xdefi.setupXDEFI(),
  ] as unknown[]) as WalletModuleFactory[];
}

export function removeWallet(network: Network, onChange: (s: WalletState) => void): Promise<RemoveWallet> {
  let p = cache.get(network);
  if (!p) { p = load(network); cache.set(network, p); }
  return p.then((w) => { onChange(w.state()); subs.set(network, onChange); return w; });
}
const subs = new Map<Network, (s: WalletState) => void>();

async function load(network: Network): Promise<RemoveWallet> {
  await import("./wallet-shims");
  const [{ setupWalletSelector, actionCreators }, { setupModal }, { PublicKey }] = await Promise.all([
    import("@near-wallet-selector/core"), import("@near-wallet-selector/modal-ui"), import("@near-js/crypto"),
    import("@near-wallet-selector/modal-ui/styles.css"),
  ]);
  const selector = await setupWalletSelector({ network, modules: await modules(), allowMultipleSelectors: true });
  // No contractId: sign-in shares the account name only and asks for no access key.
  const modal = setupModal(selector, { theme: "auto" });
  let st: WalletState = { accountId: null, wallet: null };
  const read = () => {
    const s = selector.store.getState();
    const acc = s.accounts.find((a) => a.active) ?? s.accounts[0];
    st = { accountId: acc?.accountId ?? null, wallet: s.selectedWalletId ? s.modules.find((x) => x.id === s.selectedWalletId)?.metadata.name ?? s.selectedWalletId : null };
    subs.get(network)?.(st);
  };
  read();
  selector.store.observable.subscribe(read);
  return {
    state: () => st,
    connect: () => modal.show(),
    async switchWallet() { if (selector.isSignedIn()) await (await selector.wallet()).signOut().catch(() => {}); modal.show(); },
    async removeKey(account, publicKey, callbackUrl) {
      if (st.accountId !== account) throw new Error(`Your wallet is signed in as ${st.accountId ?? "nobody"}, not ${account}.`);
      const wallet = await selector.wallet();
      // signAndSendTransactions (not the singular form): HERE ignores receiverId on the singular call.
      const tx = { signerId: account, receiverId: account, actions: [actionCreators.deleteKey(PublicKey.from(publicKey))] };
      const out = await wallet.signAndSendTransactions({ transactions: [tx], ...(wallet.type === "browser" ? { callbackUrl } : {}) } as Parameters<typeof wallet.signAndSendTransactions>[0]);
      const first = Array.isArray(out) ? out[0] : undefined;
      return first?.transaction?.hash ?? (first as { transaction_outcome?: { id?: string } } | undefined)?.transaction_outcome?.id;
    },
  };
}
