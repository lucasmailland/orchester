// apps/web/tests/integration/auth/signup-mode.spec.ts
//
// SIGNUP_MODE contract against a real testcontainer-backed postgres: the
// gate lives in better-auth's user-create hook, so this drives the real
// signup endpoint rather than the policy function alone.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { createId } from "@paralleldrive/cuid2";
import { schema } from "@orchester/db";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");
vi.unmock("@/lib/auth");
vi.doUnmock("@/lib/auth");

import { setupTestDb } from "../../fixtures/db";
import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";

let wsA: WsFixture;
let auth: typeof import("@/lib/auth").auth;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ auth } = await import("@/lib/auth"));
});
afterAll(() => teardownTestWorkspaces());
afterEach(() => {
  vi.unstubAllEnvs();
});

async function invite(email: string, expiresAt: Date) {
  const { db } = await setupTestDb();
  await db.insert(schema.workspaceInvites).values({
    id: createId(),
    workspaceId: wsA.id,
    email,
    role: "editor",
    token: createId(),
    invitedByUserId: wsA.ownerId,
    expiresAt,
  });
}

function signUp(email: string) {
  return auth.api.signUpEmail({
    body: { email, password: "correct-horse-battery", name: "Test User" },
  });
}

const inAWeek = () => new Date(Date.now() + 7 * 24 * 3600 * 1000);

describe("SIGNUP_MODE", () => {
  it("open lets anyone sign up", async () => {
    vi.stubEnv("SIGNUP_MODE", "open");
    const res = await signUp(`open-${createId()}@example.com`);
    expect(res.user.id).toBeTruthy();
  });

  it("closed refuses every signup", async () => {
    vi.stubEnv("SIGNUP_MODE", "closed");
    await expect(signUp(`closed-${createId()}@example.com`)).rejects.toThrow(/invite/i);
  });

  it("invite refuses an email without a pending invite", async () => {
    vi.stubEnv("SIGNUP_MODE", "invite");
    await expect(signUp(`stranger-${createId()}@example.com`)).rejects.toThrow(/invite/i);
  });

  it("invite accepts an email with a pending invite, whatever its case", async () => {
    vi.stubEnv("SIGNUP_MODE", "invite");
    const email = `invited-${createId()}@example.com`;
    await invite(email.toUpperCase(), inAWeek());
    const res = await signUp(email);
    expect(res.user.email).toBe(email);
  });

  it("invite refuses an email whose invite expired", async () => {
    vi.stubEnv("SIGNUP_MODE", "invite");
    const email = `expired-${createId()}@example.com`;
    await invite(email, new Date(Date.now() - 1000));
    await expect(signUp(email)).rejects.toThrow(/invite/i);
  });
});
