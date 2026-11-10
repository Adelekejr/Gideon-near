# @gideon/mcp

An MCP server (stdio, official TypeScript MCP SDK v2) that lets an AI agent check a NEAR send before making it. It is read-only: it never sees keys and never signs.

| Tool | What it does |
| --- | --- |
| `gideon_check` | Runs Gideon’s address rules on `recipient` (plus optional `network`, `amount`, `token`, `token_contract`, `destination`, `exchange`, `sender`, `address_book`, `memo`, `payee`, `chain`, `daily_limit`). R10 stays skipped unless a registry is set. Returns `verdict`, `agent_action`, `reasons`, `fix`, `couldnt_check`, `receipt` and the full `result`. A failed drained-wallet lookup is look again, never a pass. |
| `gideon_check_transaction` | Checks a transaction or sign-in before you approve it (`request` is a wallet link, base64, or JSON). This includes a function-call key granted to an unfamiliar contract. Returns the same shape as `gideon_check`. |
| `gideon_account_health` | Lists the keys that can act for an account, from public data, and what each one can do. |
| `gideon_explain` | Plain-words explanation of a `result` from `gideon_check`, or of a fresh address check. It does not take a `gideon_check_transaction` result. Uses NEAR AI only if `NEARAI_API_KEY` is set, otherwise the built-in text. Refuses a result whose receipt doesn't match. |
| `gideon_flags` | Community flags on an account from a flag registry contract. **Not deployed.** With no registry set the status is `COULD_NOT_CHECK`, never “no flags”. There is no live community scam database. |

**Agent policy** (sent as the server's `instructions` and as `agent_action` on every result). The `from` / `ASK_HUMAN` rule applies to `gideon_check`. On a transaction check (`gideon_check_transaction`), SAFE is `SEND`.

| verdict | agent_action | Gideon asks (it cannot force this) |
| --- | --- | --- |
| SAFE | `SEND` when `from` was passed, otherwise `ASK_HUMAN` | SAFE is not proof of who controls the account. Pass `from` so the first-send check runs. Without it, ask a human. A process-local daily cap (`GIDEON_DAILY_LIMIT` or `daily_limit`; the lower one wins) that this send would go over also returns `ASK_HUMAN`. |
| ATTENTION | `ASK_HUMAN` | not send on its own; ask a human. This includes a memo that reads like an instruction, a saved contact whose address changed, a deposit Gideon couldn't confirm, and a spend over the daily cap. |
| BLOCKED | `DO_NOT_SEND` | not send; report the reason and fix |

**What this server does not enforce.** An agent can ignore `DO_NOT_SEND` or `ASK_HUMAN` and still send. Stopping the send has to happen in the wallet or in the other code that signs. Gideon never sees keys.

The daily cap is **process-local and advisory**. `packages/mcp/src/spend.ts` keeps an in-memory `Map` of NEAR this process has already cleared to SEND (a SAFE result), per account, for the UTC day. The map resets when the process restarts. Each running instance has its own map. Repeating a successful check counts again, even if nothing moved on chain. It is not an account-wide durable limit, and it does not read chain spend. The CLI does not keep this map. A sha256 receipt is the integrity of the printed result, not proof the checks were performed honestly, and not an attestation.

Run: `node packages/mcp/dist/index.js` (after `npm install` at the repo root). The server reports package version `0.1.0` (unpublished). The product, site, and extension are 0.3.4; see the repo README. Env: `GIDEON_NETWORK`, `GIDEON_FLAG_REGISTRY` (no registry is deployed; leave this unset and the flag check stays off), `GIDEON_RECEIPT_KEY`, `GIDEON_DAILY_LIMIT` (the process-local NEAR cap above), `NEARAI_API_KEY`, `NEARAI_MODEL`, `NEARBLOCKS_API_KEY`, and `GIDEON_REPLAY=<fixtures.json>` to answer offline from a recording (demos and tests only).

Demo: `npm run demo:agent`, `npm run demo:attack`, and `npm run demo:function-call-key`. Each accepts `-- --offline` (recorded answers, no network). The attack demo reads a planted lookalike invoice and stops on BLOCKED / DO_NOT_SEND. The function-call key demo holds one app key for `ft_transfer` on `wrap.testnet` (gas allowance only; it cannot transfer NEAR or add a key) and runs that same payee through Gideon before it would call the contract. Gideon advises: an agent that ignores DO_NOT_SEND can still send when its key allows the call. Neither demo has a secret or signs. Config for Claude Desktop and Cursor is on the website Docs page (`apps/web/docs.html`) and the agents page.
