// Some wallet modules expect Node's `global`, `Buffer` and `process.env`. Loaded before them, on this page only.
import { Buffer } from "buffer";
const g = globalThis as unknown as { global?: unknown; Buffer?: unknown; process?: { env: Record<string, string> } };
g.global ??= globalThis;
g.Buffer ??= Buffer;
g.process ??= { env: {} };
export {};
