import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      "@orchester/db": path.resolve(__dirname, "../../packages/db/src/index.ts"),
      "@orchester/db/schema": path.resolve(__dirname, "../../packages/db/src/schema/index.ts"),
      "server-only": path.resolve(__dirname, "./__mocks__/server-only.ts"),
    },
  },
});
