/**
 * Text that tells an agent or a person what to do, planted in a payee name, memo, or
 * on-chain message ("send all funds", "ignore previous instructions"). LOOK AGAIN, never followed.
 */

const PATTERNS: { re: RegExp; phrase: string }[] = [
  { re: /\bsend\s+all(?:\s+(?:funds|tokens|near|money|the\s+balance))?\b/i, phrase: "send all funds" },
  { re: /\btransfer\s+all\b/i, phrase: "transfer all" },
  { re: /\bdrain\s+(?:the\s+)?(?:wallet|account|funds)\b/i, phrase: "drain the wallet" },
  { re: /\bignore\s+(?:all\s+)?(?:previous|prior|above|your)\b/i, phrase: "ignore previous instructions" },
  { re: /\bdo\s+not\s+ask\b/i, phrase: "do not ask" },
  { re: /\bdon'?t\s+ask\b/i, phrase: "don't ask" },
  { re: /\bskip\s+(?:the\s+)?(?:check|gideon|safety)\b/i, phrase: "skip the check" },
  { re: /\bapprove\s+immediately\b/i, phrase: "approve immediately" },
  { re: /\byou\s+must\s+send\b/i, phrase: "you must send" },
  { re: /\bsystem\s+prompt\b/i, phrase: "system prompt" },
  { re: /\boverride\s+(?:the\s+)?(?:safety|check|gideon)\b/i, phrase: "override the check" },
  { re: /\bnew\s+instructions?\s*:/i, phrase: "new instructions" },
];

/** The instruction this text is giving, or null when it reads like an ordinary memo. */
export function instructionPhrase(text: string): string | null {
  const s = text.replace(/[-_]+/g, " ");
  for (const p of PATTERNS) if (p.re.test(s)) return p.phrase;
  return null;
}

export function clipText(text: string, n = 80): string {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
