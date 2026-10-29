#!/usr/bin/env node
// Gideon MCP server over stdio. Logs go to stderr; stdout carries MCP messages only.
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createGideonServer, VERSION } from "./server.js";

const server = createGideonServer();
await server.connect(new StdioServerTransport());
console.error(`gideon-mcp ${VERSION} ready on stdio${process.env.GIDEON_REPLAY ? " (offline replay)" : ""}`);
