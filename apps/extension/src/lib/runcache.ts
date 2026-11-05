import type { CheckInput, CheckResult } from "@gideon/core";

/** Cache key for one finished check: every input that can change the answer. */
export function checkKey(input: CheckInput): string {
  const { to, network, asset, amount, destination, exchange, from, addressBook, clipboard, deviceSends, walletNetwork, memo, payee, bridgeChain, dailyLimit, spentToday } = input;
  return JSON.stringify([network, to, asset ?? null, amount ?? null, destination ?? null, exchange ?? null, from ?? null, clipboard ?? null, addressBook ?? [], deviceSends ?? [], walletNetwork ?? null, memo ?? null, payee ?? null, bridgeChain ?? null, dailyLimit ?? null, spentToday ?? null]);
}

/**
 * Keep only complete answers. Anything a source didn't answer (including an info-only creation
 * date) is asked again next time, so a slow first answer fills in on the next look.
 */
export function cacheable(r: CheckResult): boolean {
  return r.sources.every((c) => c.ok) && !r.findings.some((f) => f.status === "COULD_NOT_CHECK");
}

/** True when the answer is complete except for info-only lookups that failed or ran out of time. */
export function missingOptional(r: CheckResult): boolean {
  return r.sources.some((c) => c.optional && !c.ok) && !r.sources.some((c) => !c.optional && !c.ok);
}
