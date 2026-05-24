// apps/web/tests/integration/feature-flags/check.spec.ts
//
// Spec: docs/specs/2026-05-23-tenant-hardening-design.md
// Plan: Task A.21
//
// Drives `isEnabled` / `setFlag` against a real postgres
// (testcontainer) to verify per-workspace cache + DB roundtrip works
// for the happy path.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// The global vitest.setup.ts stubs out @orchester/db so unit tests can
// import server modules without a DB. Integration tests need the real
// thing — un-mock first, then dynamic-import everything that touches it.
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";

let wsA: WsFixture;
let isEnabled: typeof import("@/lib/feature-flags").isEnabled;
let setFlag: typeof import("@/lib/feature-flags").setFlag;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ isEnabled, setFlag } = await import("@/lib/feature-flags"));
});
afterAll(() => teardownTestWorkspaces());

describe("feature-flags", () => {
  it("returns false for unset flag", async () => {
    expect(await isEnabled(wsA.id, "nonexistent_flag")).toBe(false);
  });

  it("returns true after setFlag(true)", async () => {
    await setFlag(wsA.id, "test_flag", true, { userId: wsA.ownerId });
    expect(await isEnabled(wsA.id, "test_flag")).toBe(true);
  });

  it("returns false after setFlag(false)", async () => {
    await setFlag(wsA.id, "test_flag", false, { userId: wsA.ownerId });
    expect(await isEnabled(wsA.id, "test_flag")).toBe(false);
  });
});
