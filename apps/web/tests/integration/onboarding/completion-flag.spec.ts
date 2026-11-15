// apps/web/tests/integration/onboarding/completion-flag.spec.ts
//
// SET-9 — the live first-mile flow must set users.onboarding_completed so
// the (shell)/layout guard doesn't loop a fresh user back to onboarding.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

// getCurrentSession is what the action reads — stub it to our fixture user.
let wsOwnerId = "";
vi.mock("@/lib/workspace", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    getCurrentSession: vi.fn(async () => ({
      user: { id: wsOwnerId, email: "u@test.local", name: "U" },
    })),
  };
});

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";

let wsA: WsFixture;
let markOnboardingComplete: typeof import("@/app/actions/first-mile-onboarding").markOnboardingComplete;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;
let eq: typeof import("drizzle-orm").eq;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  wsOwnerId = wsA.ownerId;
  ({ markOnboardingComplete } = await import("@/app/actions/first-mile-onboarding"));
  ({ getDb, schema } = await import("@orchester/db"));
  ({ eq } = await import("drizzle-orm"));
}, 60_000);

afterAll(() => teardownTestWorkspaces());

it("sets users.onboarding_completed when the first-mile wizard finishes", async () => {
  await markOnboardingComplete();
  const rows = await getDb()
    .select({ done: schema.users.onboardingCompleted })
    .from(schema.users)
    .where(eq(schema.users.id, wsA.ownerId));
  expect(rows[0]!.done).toBe(true);
});
