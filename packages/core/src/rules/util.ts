import type { Finding, RuleId, Status } from "../types.js";

export type RuleResult = Finding | Finding[] | null;

export function f(rule: RuleId, status: Status, code: string, title: string, detail: string, extra: Partial<Finding> = {}): Finding {
  return { rule, code, status, title, detail, ...extra };
}

export function skipped(rule: RuleId, detail: string): Finding {
  return f(rule, "SKIPPED", "NOT_APPLICABLE", "Not applicable", detail);
}

export function couldNotCheck(rule: RuleId, what: string, error: string): Finding {
  return f(rule, "COULD_NOT_CHECK", "SOURCE_DOWN", `Couldn't check: ${what}`,
    `A data source didn't answer (${error}). Gideon won't call this send safe until it can check. Try again in a minute.`);
}

export function short(s: string, head = 8, tail = 6): string {
  return s.length > head + tail + 1 ? `${s.slice(0, head)}…${tail > 0 ? s.slice(-tail) : ""}` : s;
}
