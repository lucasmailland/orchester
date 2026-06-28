// apps/web/tests/integration/feature-flags/known-flags.spec.ts
//
// SET-3 — KNOWN_FLAGS catalog + a real consumer. We flip a catalog flag
// and assert isEnabled reflects it (round-trip through the real cache+DB).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

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
let KNOWN_FLAGS: typeof import("@/lib/feature-flags").KNOWN_FLAGS;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ isEnabled, setFlag, KNOWN_FLAGS } = await import("@/lib/feature-flags"));
}, 60_000);

afterAll(() => teardownTestWorkspaces());

describe("KNOWN_FLAGS catalog", () => {
  it("exposes a non-empty catalog with stable keys", () => {
    expect(KNOWN_FLAGS.length).toBeGreaterThanOrEqual(1);
    const keys = KNOWN_FLAGS.map((f) => f.key);
    expect(keys).toContain("brain_graph_3d");
  });

  it("a catalog flag round-trips through isEnabled", async () => {
    expect(await isEnabled(wsA.id, "brain_graph_3d")).toBe(false); // default off
    await setFlag(wsA.id, "brain_graph_3d", true, { userId: wsA.ownerId });
    expect(await isEnabled(wsA.id, "brain_graph_3d")).toBe(true);
  });
});
