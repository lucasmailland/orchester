// apps/web/tests/integration/mnemo/cron-schedules.spec.ts
//
// SET-2 (BLOCKED ON mnemosyne SDK) — the cron-schedules proxy returns one
// row per known job and PATCH forwards mode/customCron to the SDK.
import { describe, it, vi } from "vitest";

// Mock the SDK surface the route will call (names per the shipped SDK).
vi.mock("@mnemo-ai/client-ts", () => ({
  createClient: () => ({
    listCronSchedules: async () => [{ jobKey: "dedup", mode: "default", cron: "0 3 * * 0" }],
    updateCronSchedule: async (key: string, body: { mode: string }) => {
      return { jobKey: key, mode: body.mode };
    },
  }),
}));

describe("mnemo cron-schedules proxy (SET-2 — BLOCKED ON mnemosyne SDK)", () => {
  it.skip("BLOCKED ON mnemosyne SDK — unskip when @mnemo-ai/client-ts exposes cron + triggers", () => {
    // When the SDK lands:
    // 1. Remove the it.skip and replace vi.mock with real SDK mock
    // 2. Drive GET /api/mnemo/cron-schedules and assert it returns one row per known job
    // 3. Drive PATCH /api/mnemo/cron-schedules/[key] and assert it forwards mode to the SDK
    // 4. Set CRON_SCHEDULES_ENABLED = true in MemoryOpsClient.tsx
    // 5. Remove unavailable: true from the 4 stub tasks in MemoryOpsClient.tsx
  });
});
