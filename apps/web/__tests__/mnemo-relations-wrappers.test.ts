// apps/web/__tests__/mnemo-relations-wrappers.test.ts
//
// Unit tests for the three server-only wrapper modules.
// `server-only` is aliased to a no-op stub in vitest.config.ts.
// `@/lib/mnemo/client` is mocked so we control the returned client.
//
// Pattern: build a minimal partial stub of MnemosyneClient, inject it,
// then assert the wrapper delegates correctly and maps errors.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MnemosyneClient } from "@mnemo-ai/client-ts";

// ─── shared stub helpers ────────────────────────────────────────────────────

type ClientStub = Partial<MnemosyneClient>;

let clientStub: ClientStub = {};

vi.mock("@/lib/mnemo/client", () => ({
  getMnemoMode: () => "service" as const,
  getMnemoClient: () => clientStub as MnemosyneClient,
}));

import { MnemosyneAPIError } from "@mnemo-ai/client-ts";

beforeEach(() => {
  clientStub = {};
});

// ─── listWorkspaceRelations ──────────────────────────────────────────────────

describe("listWorkspaceRelations", () => {
  it("delegates to client.listRelations and wraps the response", async () => {
    const fakeList = { relations: [], total: 0 };
    clientStub.listRelations = vi.fn().mockResolvedValue(fakeList);

    const { listWorkspaceRelations } = await import("@/lib/mnemo/relations");
    const result = await listWorkspaceRelations("ws-1", { limit: 10 });

    expect(result.mode).toBe("service");
    expect(result.data).toBe(fakeList);
    expect(clientStub.listRelations).toHaveBeenCalledWith({ limit: 10 });
  });

  it("passes judgmentStatus when provided", async () => {
    clientStub.listRelations = vi.fn().mockResolvedValue({ relations: [], total: 0 });

    const { listWorkspaceRelations } = await import("@/lib/mnemo/relations");
    await listWorkspaceRelations("ws-1", { judgmentStatus: "pending", limit: 20 });

    expect(clientStub.listRelations).toHaveBeenCalledWith({
      judgmentStatus: "pending",
      limit: 20,
    });
  });
});

// ─── patchWorkspaceRelation ──────────────────────────────────────────────────

describe("patchWorkspaceRelation", () => {
  it("returns the patched relation on success", async () => {
    const fakeRelation = { id: "rel-1", relation: "related" };
    clientStub.patchRelation = vi.fn().mockResolvedValue(fakeRelation);

    const { patchWorkspaceRelation } = await import("@/lib/mnemo/relations");
    const result = await patchWorkspaceRelation("ws-1", "rel-1", {
      relation: "related",
      markedByKind: "user",
    });

    expect(result.mode).toBe("service");
    expect(result.data).toBe(fakeRelation);
  });

  it("returns data:null when patchRelation throws a 404", async () => {
    const err = new MnemosyneAPIError({ status: 404, message: "not found", code: "not_found" });
    clientStub.patchRelation = vi.fn().mockRejectedValue(err);

    const { patchWorkspaceRelation } = await import("@/lib/mnemo/relations");
    const result = await patchWorkspaceRelation("ws-1", "missing", {
      relation: "related",
      markedByKind: "user",
    });

    expect(result.data).toBeNull();
    expect(result.mode).toBe("service");
  });

  it("re-throws non-404 errors", async () => {
    const err = new MnemosyneAPIError({
      status: 500,
      message: "server error",
      code: "server_error",
    });
    clientStub.patchRelation = vi.fn().mockRejectedValue(err);

    const { patchWorkspaceRelation } = await import("@/lib/mnemo/relations");
    await expect(
      patchWorkspaceRelation("ws-1", "rel-1", { relation: "related", markedByKind: "user" })
    ).rejects.toThrow(MnemosyneAPIError);
  });
});

// ─── createWorkspaceRelation ─────────────────────────────────────────────────

describe("createWorkspaceRelation", () => {
  it("delegates to client.createRelation and wraps the response", async () => {
    const fakeRelation = { id: "rel-new", relation: "derived_from" };
    clientStub.createRelation = vi.fn().mockResolvedValue(fakeRelation);

    const { createWorkspaceRelation } = await import("@/lib/mnemo/relations");
    const input = {
      sourceKind: "fact" as const,
      sourceId: "f-1",
      targetKind: "fact" as const,
      targetId: "f-2",
      relation: "derived_from" as const,
      markedByKind: "user" as const,
    };
    const result = await createWorkspaceRelation("ws-1", input);

    expect(result.mode).toBe("service");
    expect(result.data).toBe(fakeRelation);
    expect(clientStub.createRelation).toHaveBeenCalledWith(input);
  });
});

// ─── listWorkspaceConflicts ──────────────────────────────────────────────────

describe("listWorkspaceConflicts", () => {
  it("delegates to client.judge and clamps limit to 20", async () => {
    const fakeConflicts = { pairs: [], total: 0 };
    clientStub.judge = vi.fn().mockResolvedValue(fakeConflicts);

    const { listWorkspaceConflicts } = await import("@/lib/mnemo/judge");
    const result = await listWorkspaceConflicts("ws-1", { limit: 99 });

    expect(result.data).toBe(fakeConflicts);
    expect(clientStub.judge).toHaveBeenCalledWith({ limit: 20 });
  });

  it("uses default limit (20) when no limit is provided", async () => {
    const fakeConflicts = { pairs: [], total: 0 };
    clientStub.judge = vi.fn().mockResolvedValue(fakeConflicts);

    const { listWorkspaceConflicts } = await import("@/lib/mnemo/judge");
    await listWorkspaceConflicts("ws-1");

    expect(clientStub.judge).toHaveBeenCalledWith({ limit: 20 });
  });
});

// ─── resolveWorkspaceConflict ────────────────────────────────────────────────

describe("resolveWorkspaceConflict", () => {
  it("returns the resolve response on success", async () => {
    const fakeResolve = { ok: true };
    clientStub.resolveConflict = vi.fn().mockResolvedValue(fakeResolve);

    const { resolveWorkspaceConflict } = await import("@/lib/mnemo/judge");
    const result = await resolveWorkspaceConflict("ws-1", "rel-1", { action: "keep_both" });

    expect(result.mode).toBe("service");
    expect(result.data).toBe(fakeResolve);
  });

  it("returns data:null on 404", async () => {
    const err = new MnemosyneAPIError({ status: 404, message: "not found", code: "not_found" });
    clientStub.resolveConflict = vi.fn().mockRejectedValue(err);

    const { resolveWorkspaceConflict } = await import("@/lib/mnemo/judge");
    const result = await resolveWorkspaceConflict("ws-1", "gone", { action: "keep_both" });

    expect(result.data).toBeNull();
  });
});

// ─── listWorkspaceDecisions ──────────────────────────────────────────────────

describe("listWorkspaceDecisions", () => {
  it("delegates to client.listDecisions", async () => {
    const fakeList = { decisions: [], total: 0 };
    clientStub.listDecisions = vi.fn().mockResolvedValue(fakeList);

    const { listWorkspaceDecisions } = await import("@/lib/mnemo/decisions");
    const result = await listWorkspaceDecisions("ws-1", { limit: 50 });

    expect(result.mode).toBe("service");
    expect(result.data).toBe(fakeList);
    expect(clientStub.listDecisions).toHaveBeenCalledWith({ limit: 50 });
  });
});

// ─── supersedeWorkspaceDecision ──────────────────────────────────────────────

describe("supersedeWorkspaceDecision", () => {
  it("returns the superseded decision + edgeCreated:true on full success", async () => {
    const fakeDecision = { id: "d-old", status: "superseded" };
    clientStub.supersedeDecision = vi.fn().mockResolvedValue(fakeDecision);
    clientStub.createRelation = vi.fn().mockResolvedValue({});

    const { supersedeWorkspaceDecision } = await import("@/lib/mnemo/decisions");
    const result = await supersedeWorkspaceDecision("ws-1", "d-old", "d-new", "user-1");

    expect(result.data).toBe(fakeDecision);
    expect(result.edgeCreated).toBe(true);
    expect(clientStub.createRelation).toHaveBeenCalledWith(
      expect.objectContaining({ relation: "supersedes" })
    );
  });

  it("returns edgeCreated:false when lineage edge creation fails (non-fatal)", async () => {
    const fakeDecision = { id: "d-old", status: "superseded" };
    clientStub.supersedeDecision = vi.fn().mockResolvedValue(fakeDecision);
    clientStub.createRelation = vi.fn().mockRejectedValue(new Error("conflict"));

    const { supersedeWorkspaceDecision } = await import("@/lib/mnemo/decisions");
    const result = await supersedeWorkspaceDecision("ws-1", "d-old", "d-new", "user-1");

    expect(result.data).toBe(fakeDecision);
    expect(result.edgeCreated).toBe(false);
  });

  it("returns data:null when supersedeDecision 404s", async () => {
    const err = new MnemosyneAPIError({ status: 404, message: "not found", code: "not_found" });
    clientStub.supersedeDecision = vi.fn().mockRejectedValue(err);

    const { supersedeWorkspaceDecision } = await import("@/lib/mnemo/decisions");
    const result = await supersedeWorkspaceDecision("ws-1", "gone", "d-new", "user-1");

    expect(result.data).toBeNull();
    expect(result.edgeCreated).toBe(false);
  });
});
