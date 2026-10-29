# packages/mcp (scaffold)

A planned MCP server that lets AI agents ask Gideon before they send.
**Not built yet.** Today an agent can already call `check()` from
`@gideon/core`, or shell out to the CLI with `--json` and read the exit code
(0 SAFE, 1 ATTENTION, 2 BLOCKED).

## Planned tools

| Tool | Input | Output |
| --- | --- | --- |
| `check_send` | `to`, `token`, `amount`, `network`, `destination`, `exchange?`, `from?` | verdict, reason code, plain-words reason, fix steps, receipt |
| `explain` | a check result | plain-words explanation (built-in text, or NEAR AI if a key is set; it can never change the verdict) |
| `verify_receipt` | a check result | whether the receipt hash (and signature, if signed) matches |

## Rules for this package

- Read-only. No keys, no signing, no custody.
- `COULD_NOT_CHECK` is returned as such. The agent must not treat it as safe.
- Network comes from the call, then `GIDEON_NETWORK`, then testnet.
