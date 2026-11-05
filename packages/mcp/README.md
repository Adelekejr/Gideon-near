# @gideon/mcp

An MCP server (stdio, official TypeScript MCP SDK v2) that lets an AI agent check a NEAR send before making it. It is read-only: it never sees keys and never signs.

| Tool | What it does |
| --- | --- |
| `gideon_check` | Runs every Gideon rule on `recipient` (plus optional `network`, `amount`, `token`, `token_contract`, `destination`, `exchange`, `sender`, `address_book`). Returns `verdict`, `agent_action`, `reasons`, `fix`, `couldnt_check`, `receipt` and the full `result`. |
| `gideon_explain` | Plain-words explanation of a `result` from `gideon_check`, or of a fresh check. Uses NEAR AI only if `NEARAI_API_KEY` is set, otherwise the built-in text. Refuses a result whose receipt doesn't match. |
| `gideon_flags` | Community flags on an account from the flag registry. `COULD_NOT_CHECK` when no registry is set or it can't be read. |

**Agent policy** (sent as the server's `instructions` and as `agent_action` on every result):

| verdict | agent_action | the agent must |
| --- | --- | --- |
| SAFE | `SEND` when `from` was passed, otherwise `ASK_HUMAN` | SAFE is not proof of who controls the account. Pass `from` so the first-send check runs. Without it, ask a human. |
| ATTENTION | `ASK_HUMAN` | not send on its own; ask a human |
| BLOCKED | `DO_NOT_SEND` | not send; report the reason and fix |

Run: `node packages/mcp/dist/index.js` (after `npm install` at the repo root). Env: `GIDEON_NETWORK`, `GIDEON_FLAG_REGISTRY`, `GIDEON_RECEIPT_KEY`, `NEARAI_API_KEY`, `NEARAI_MODEL`, `NEARBLOCKS_API_KEY`, and `GIDEON_REPLAY=<fixtures.json>` to answer offline from a recording (demos and tests only).

Demo: `npm run demo:agent`, `npm run demo:attack`, and `npm run demo:function-call-key`. Each accepts `-- --offline` (recorded answers, no network). The attack demo reads a planted lookalike invoice and stops on BLOCKED / DO_NOT_SEND. The function-call key demo holds one app key for `ft_transfer` on `wrap.testnet` (gas allowance only; it cannot transfer NEAR or add a key) and runs that same payee through Gideon before it would call the contract. Gideon advises: an agent that ignores DO_NOT_SEND can still send when its key allows the call. Neither demo has a secret or signs. Config for Claude Desktop and Cursor is on the website Docs page (`apps/web/docs.html`) and the agents page.
