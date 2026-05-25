import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../../apps/web/tests/fixtures/workspaces";

let wsA: WsFixture;
let createFact: typeof import("../../src/primitives/fact").createFact;
let getFact: typeof import("../../src/primitives/fact").getFact;
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();
  ({ createFact, getFact } = await import("../../src/primitives/fact"));
  ({ withMnemoTx } = await import("../../src/tx"));
});
afterAll(() => teardownTestWorkspaces());

describe("primitives/fact PII wiring", () => {
  it("redacts email in statement and tags metadata.pii", async () => {
    const f = await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "preference",
        subject: "lucas-pii-test",
        statement: "contact me at lucas@example.com whenever you need",
        tx,
      })
    );

    const g = await withMnemoTx(wsA.id, (tx) => getFact(wsA.id, f.id, tx));
    expect(g).not.toBeNull();
    expect(g!.statement).toContain("[REDACTED-email]");
    expect(g!.statement).not.toContain("lucas@example.com");
    const pii = (g!.metadata as { pii?: { categories: string[]; detected_at: string } }).pii;
    expect(pii).toBeDefined();
    expect(pii!.categories).toContain("email");
    expect(typeof pii!.detected_at).toBe("string");
  });

  it("leaves clean statements unchanged and adds no pii metadata", async () => {
    const f = await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "trait",
        subject: "lucas-clean-test",
        statement: "is fluent in Spanish",
        tx,
      })
    );

    const g = await withMnemoTx(wsA.id, (tx) => getFact(wsA.id, f.id, tx));
    expect(g!.statement).toBe("is fluent in Spanish");
    expect((g!.metadata as { pii?: unknown }).pii).toBeUndefined();
  });

  it("preserves caller-supplied metadata when redaction adds pii block", async () => {
    const f = await withMnemoTx(wsA.id, (tx) =>
      createFact({
        workspaceId: wsA.id,
        scope: "global",
        kind: "event",
        subject: "lucas-meta-merge-test",
        statement: "sent invoice to billing@acme.com last quarter",
        metadata: { source: "test", tags: ["billing"] },
        tx,
      })
    );

    const g = await withMnemoTx(wsA.id, (tx) => getFact(wsA.id, f.id, tx));
    const meta = g!.metadata as {
      source?: string;
      tags?: string[];
      pii?: { categories: string[] };
    };
    expect(meta.source).toBe("test");
    expect(meta.tags).toEqual(["billing"]);
    expect(meta.pii?.categories).toContain("email");
    expect(g!.statement).toContain("[REDACTED-email]");
  });
});
