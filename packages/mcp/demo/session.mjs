// Shared stdio client for the scripted demos. They all talk to the same MCP server.
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

export const root = fileURLToPath(new URL("../../../", import.meta.url));

export function colors() {
  const tty = process.stdout.isTTY && !process.env.NO_COLOR;
  const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  return { c };
}

export function wantsOffline(argv = process.argv) {
  return argv.includes("--offline");
}

/** Start the Gideon MCP server and return a client. `--offline` replays demo/fixtures.json. */
export async function connectGideon({ name, offline }) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [`${root}packages/mcp/dist/index.js`],
    env: { PATH: process.env.PATH ?? "", ...(offline ? { GIDEON_REPLAY: `${root}demo/fixtures.json` } : {}) },
    stderr: "ignore",
  });
  const client = new Client({ name, version: "0.1.0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  return { client, tools, async close() { await client.close(); } };
}
