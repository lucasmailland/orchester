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
      // @mnemosyne/core has been removed from orchester's runtime in
      // Phase 3. Any test that still references the old library is
      // either skipped or rewired to mock the stubs at
      // `apps/web/lib/dead-mnemo-stubs.ts`.
      "server-only": path.resolve(__dirname, "./__mocks__/server-only.ts"),
    },
  },
});
