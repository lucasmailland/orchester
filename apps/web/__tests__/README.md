# Web tests

Unit and integration tests live alongside this folder and run via Vitest:

```bash
pnpm --filter @orchester/web test
```

End-to-end tests for the onboarding wizard live under `e2e/` and run with Playwright. Install once with `pnpm --filter @orchester/web add -D @playwright/test && pnpm --filter @orchester/web exec playwright install chromium`, then run:

```bash
pnpm --filter @orchester/web exec playwright test
```

The Playwright config (`apps/web/playwright.config.ts`) targets `http://localhost:3334` and reuses an existing dev server when one is running. Specs stub `/api/providers` and `/api/agents` via `page.route`, so no real OpenAI or Anthropic key is needed.
