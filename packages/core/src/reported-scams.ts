import type { Network } from "./types.js";

/**
 * Accounts publicly reported as scams, each with the report that names it. Gideon's own short
 * list, written from the public reports below (not copied from any explorer's label list).
 * Every entry was re-read at its source on the date in `checked`.
 */
export interface ReportedScam {
  account: string;
  network: Network;
  /** What the report says, in a few words. */
  what: string;
  /** Where it was reported (the link the card shows). */
  url: string;
  /** Who reported it, and when. */
  by: string;
  /** A short quote from the report. */
  quote: string;
  /** When Gideon last re-read the report (YYYY-MM-DD). */
  checked: string;
}

export const REPORTED_SCAMS: ReportedScam[] = [
  {
    account: "bigbank101.near",
    network: "mainnet",
    what: "received funds stolen by a fake NEAR wallet",
    url: "https://gov.near.org/t/11112",
    by: "NEAR Governance Forum, “[ALERT] Fake NEAR Wallet is hacking accounts”, 18 Dec 2021",
    quote: "This fake wallet request for pass phrase and after transfer funds to an account called bigbank101.near",
    checked: "2026-10-30",
  },
  {
    account: "dolbabob.near",
    network: "mainnet",
    what: "received funds stolen by the same fake NEAR wallet",
    url: "https://gov.near.org/t/11112",
    by: "NEAR Governance Forum, “[ALERT] Fake NEAR Wallet is hacking accounts”, reply of 20 Dec 2021",
    quote: "I just lose 9 NEAR there … this is the receiver account: dolbabob.near",
    checked: "2026-10-30",
  },
  {
    account: "9ebef819489ae5e6641cc5573740dadc751c35c3ae37c110e4fad8101494e418",
    network: "mainnet",
    what: "collected funds stolen through a fake NEAR wallet website",
    url: "https://gov.near.org/t/18659",
    by: "NEAR Governance Forum, “EMERGENCY SCAM! Stolen NEAR tokens … via fake website NEAR wallet”, 10 Apr 2022",
    quote: "He has accumulated all coins from my account on this wallet adess: 9ebef819…e418",
    checked: "2026-10-30",
  },
  {
    account: "axelar1yzsury9fldydgk425gmphy2zyehh3emc43ds6xusdt.near",
    network: "mainnet",
    what: "a fake “NEAR to AXL arbitrage” deposit address that looks like an Axelar address",
    url: "https://www.reddit.com/r/nearprotocol/comments/1pvnc8n/",
    by: "r/nearprotocol, “Scam alert - near to axl arbitrage scam”",
    quote: "scammer tells you to add axelar1yzsury9fldydgk425gmphy2zyehh3emc43ds6xusdt.near - scammers own address on near wallet … funds don't come back",
    checked: "2026-10-30",
  },
];

export function reportedScam(account: string, network: Network): ReportedScam | null {
  const a = account.trim().toLowerCase();
  return REPORTED_SCAMS.find((s) => s.account === a && s.network === network) ?? null;
}
