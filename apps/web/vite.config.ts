import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(root, "../..");

// Multi-page static site. The engine is imported from source, so the site always runs the same rules as the CLI and tests.
export default defineConfig({
  root,
  resolve: {
    alias: {
      "@gideon/core": resolve(repo, "packages/core/src/index.ts"),
      "@gideon/sources": resolve(repo, "packages/sources/src/index.ts"),
    },
  },
  server: { fs: { allow: [repo] } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(root, "index.html"),
        check: resolve(root, "check.html"),
        extension: resolve(root, "extension.html"),
        agents: resolve(root, "agents.html"),
        send: resolve(root, "send.html"),
        keys: resolve(root, "keys.html"),
      },
    },
  },
});
