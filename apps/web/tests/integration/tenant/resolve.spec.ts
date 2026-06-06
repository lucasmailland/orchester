// apps/web/tests/integration/tenant/resolve.spec.ts
//
// Tenant resolver contract — runs against a real testcontainer-backed
// postgres with a seeded workspace fixture. Replaces the long-skipped
// placeholders in tests/unit/tenant/resolve.spec.ts (those were left
// .skip waiting for "Task A.16 fixtures" — those fixtures now exist).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// The global vitest.setup.ts stubs out @orchester/db. Integration tests
// need the real DB module, so un-mock before any dynamic imports.
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";

let wsA: WsFixture;
let resolveBySlug: typeof import("@/lib/tenant/resolve").resolveBySlug;
let resolveById: typeof import("@/lib/tenant/resolve").resolveById;
let invalidateCache: typeof import("@/lib/tenant/resolve").invalidateCache;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ resolveBySlug, resolveById, invalidateCache } = await import("@/lib/tenant/resolve"));
});
afterAll(() => teardownTestWorkspaces());

describe("tenant/resolve", () => {
  beforeEach(() => {
    invalidateCache("*");
  });

  it("returns null for unknown slug", async () => {
    const ws = await resolveBySlug("definitely-not-a-real-slug-xyz");
    expect(ws).toBeNull();
  });

  it("returns workspace for known slug (case-sensitive)", async () => {
    const ws = await resolveBySlug(wsA.slug);
    expect(ws?.slug).toBe(wsA.slug);
    expect(ws?.id).toBe(wsA.id);
  });

  it("caches resolution (second call avoids DB)", async () => {
    const a = await resolveBySlug(wsA.slug);
    const b = await resolveBySlug(wsA.slug);
    // Referential equality => served from the LRU cache.
    expect(a).toBe(b);
  });

  it("invalidateCache clears entry", async () => {
    const a = await resolveBySlug(wsA.slug);
    invalidateCache(a!.slug);
    const b = await resolveBySlug(wsA.slug);
    expect(a).not.toBe(b); // re-fetched, different object reference
    expect(a?.id).toBe(b?.id); // but same workspace
  });

  it("resolveById hydrates the slug cache as a side-effect", async () => {
    const byId = await resolveById(wsA.id);
    expect(byId).not.toBeNull();
    const bySlug = await resolveBySlug(byId!.slug);
    // bySlug should hit the cache populated by resolveById, returning the
    // exact same reference.
    expect(bySlug).toBe(byId);
  });
});
