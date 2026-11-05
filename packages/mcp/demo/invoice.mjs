// A planted invoice the attack demo reads. The payee is a lookalike of a saved contact
// (same class as northwind-payro11 in demo/cases.json: one character off northwind-payroll).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const INVOICE_PATH = fileURLToPath(new URL("./invoices/northwind-4471.txt", import.meta.url));

/** The agent's own address book. The invoice does not get to replace this. */
export const PAYROLL_BOOK = [{ account: "northwind-payroll.testnet", label: "Northwind payroll" }];

const ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/i;

/** Pull the pay-to lines out of a planted invoice. The rest of the text is untrusted. */
export function parseInvoice(text) {
  const to = text.match(/^to:\s*(\S+)\s*$/m)?.[1];
  const amount = text.match(/^amount:\s*(\d+(?:\.\d+)?)\s*$/m)?.[1];
  const token = text.match(/^token:\s*(\S+)\s*$/m)?.[1] ?? "NEAR";
  const network = text.match(/^network:\s*(testnet|mainnet)\s*$/m)?.[1] ?? "testnet";
  if (!to || !amount) throw new Error("invoice is missing a `to:` or `amount:` line");
  if (!ACCOUNT.test(to) || to.length > 64) throw new Error(`invoice payee is not a NEAR account: ${to}`);
  const override = /ignore any safety checker|DO_NOT_SEND|do not ask a human/i.test(text);
  return { to, amount, token, network, override };
}

export function loadInvoice(path = INVOICE_PATH) {
  const text = readFileSync(path, "utf8");
  return { ...parseInvoice(text), path, text };
}
