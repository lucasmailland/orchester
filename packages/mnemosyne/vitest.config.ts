import { defineConfig } from "vitest/config";
import path from "path";

// Mnemosyne tests need the same path aliases the web app uses so we can
// import the shared embedding provider (`@/lib/embeddings`) and the
// production `@orchester/db` source (not a stub). The web `vitest.setup.ts`
// auto-mocks `@orchester/db` for component tests — we deliberately do
// not load that setup here.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // Integration suites spin up a pgvector testcontainer per process
    // (apps/web/tests/fixtures/db.ts). Container boot + migrations push
    // far past vitest's default 5s.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../../apps/web"),
      "@orchester/db": path.resolve(__dirname, "../db/src/index.ts"),
      "@orchester/db/schema": path.resolve(__dirname, "../db/src/schema/index.ts"),
      "server-only": path.resolve(__dirname, "../../apps/web/__mocks__/server-only.ts"),
    },
  },
});
