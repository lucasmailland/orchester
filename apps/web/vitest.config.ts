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
    // Playwright e2e specs (under __tests__/e2e/) are a Playwright runner
    // concern, not vitest's. Excluding them here keeps `vitest run` clean
    // without disabling their normal Playwright workflow.
    exclude: ["node_modules/**", "dist/**", ".next/**", "**/__tests__/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // Modest floors that the current suite clears; ratchet up as coverage grows.
      thresholds: {
        lines: 20,
        functions: 20,
        statements: 20,
        branches: 15,
      },
      exclude: [
        "**/__tests__/**",
        "**/tests/**",
        "**/*.config.*",
        "**/.next/**",
        "**/worker/.dist/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      "@orchester/db": path.resolve(__dirname, "../../packages/db/src/index.ts"),
      "@orchester/db/schema": path.resolve(__dirname, "../../packages/db/src/schema/index.ts"),
      // @mnemosyne/core has been removed from orchester's runtime.
      // Memory operations go through the HTTP SDK; tests that need to
      // mock memory mock @mnemosyne/client-ts directly.
      "server-only": path.resolve(__dirname, "./__mocks__/server-only.ts"),
    },
  },
});
