import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the Compass web app.
 *
 * Keep the surface narrow on purpose: chromium only, one worker per file,
 * and reuse a running dev server when present. The test suite targets the
 * first-mile onboarding wizard and must run without a real OpenAI key —
 * specs stub /api/* via page.route.
 */
export default defineConfig({
  testDir: "./__tests__/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3334",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm --filter @orchester/web dev",
    url: "http://localhost:3334",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
