import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    // Integration suites under `tests/integration/**` spin up a real
    // pgvector container via testcontainers (image pull + migrations).
    // Under load (Docker contention from sibling pods / multiple test
    // files in parallel), startup regularly exceeds the 10s vitest
    // default and fails `beforeAll`. 60s gives realistic headroom
    // without masking actual hangs.
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      "@orchester/db": path.resolve(__dirname, "../../packages/db/src/index.ts"),
      "@orchester/db/schema": path.resolve(__dirname, "../../packages/db/src/schema/index.ts"),
      // Mnemosyne v2.0 uses subpath exports — we mirror the package.json
      // `exports` map here so Vite's resolver can find `/db`, `/graph`,
      // `/graph/server`, `/protocol`. The `@mnemosyne/core` root alias MUST
      // come LAST so it doesn't shadow the more specific subpath aliases
      // (Vite picks longest-prefix-first, but order is the documented tie-break).
      "@mnemosyne/core/db": path.resolve(
        __dirname,
        "../../../mnemosyne/packages/core/src/db/index.ts"
      ),
      "@mnemosyne/core/protocol": path.resolve(
        __dirname,
        "../../../mnemosyne/packages/core/src/protocol/v1.ts"
      ),
      "@mnemosyne/core/graph/server": path.resolve(
        __dirname,
        "../../../mnemosyne/packages/core/src/graph/server.ts"
      ),
      "@mnemosyne/core/graph": path.resolve(
        __dirname,
        "../../../mnemosyne/packages/core/src/graph/index.ts"
      ),
      "@mnemosyne/core": path.resolve(__dirname, "../../../mnemosyne/packages/core/src/index.ts"),
      "server-only": path.resolve(__dirname, "./__mocks__/server-only.ts"),
    },
  },
});
