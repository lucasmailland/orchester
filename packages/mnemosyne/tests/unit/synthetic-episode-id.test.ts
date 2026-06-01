// packages/mnemosyne/tests/unit/synthetic-episode-id.test.ts
//
// v2 — Synthetic episode id helpers. Pin determinism, UUIDv5 shape,
// cross-namespace independence, and the precedence rules in
// deriveSyntheticEpisodeId().

import { describe, it, expect } from "vitest";
import {
  syntheticEpisodeIdForMessageTurn,
  syntheticEpisodeIdForDocument,
  syntheticEpisodeIdForDay,
  deriveSyntheticEpisodeId,
} from "../../src/episode/synthetic";
import { uuidV5 } from "../../src/episode/synthetic";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("uuidV5", () => {
  it("returns a valid RFC 4122 v5 UUID (version=5, variant=10)", () => {
    const id = uuidV5("5b1a8b40-1234-5b34-a5e6-7c89abcdef00", "anything");
    expect(id).toMatch(UUID_REGEX);
  });

  it("is deterministic — same (ns, name) → same UUID", () => {
    const ns = "5b1a8b40-1234-5b34-a5e6-7c89abcdef00";
    const a = uuidV5(ns, "ws-1\x00m-1");
    const b = uuidV5(ns, "ws-1\x00m-1");
    expect(a).toBe(b);
  });

  it("differs across namespaces for the same name", () => {
    const a = uuidV5("5b1a8b40-1234-5b34-a5e6-7c89abcdef00", "hello");
    const b = uuidV5("5b1a8b40-1234-5b34-a5e6-7c89abcdef01", "hello");
    expect(a).not.toBe(b);
  });

  it("throws on a malformed namespace UUID", () => {
    expect(() => uuidV5("not-a-uuid", "name")).toThrow(/invalid UUID/);
  });
});

// ── Per-helper determinism ──────────────────────────────────────────────────

describe("syntheticEpisodeIdForMessageTurn", () => {
  it("returns the same id for the same (workspace, messageUuid)", () => {
    const a = syntheticEpisodeIdForMessageTurn("ws-1", "m-1");
    const b = syntheticEpisodeIdForMessageTurn("ws-1", "m-1");
    expect(a).toBe(b);
    expect(a).toMatch(UUID_REGEX);
  });

  it("differs across messages", () => {
    expect(syntheticEpisodeIdForMessageTurn("ws-1", "m-1")).not.toBe(
      syntheticEpisodeIdForMessageTurn("ws-1", "m-2")
    );
  });

  it("differs across workspaces (tenant isolation in the id space)", () => {
    expect(syntheticEpisodeIdForMessageTurn("ws-1", "m-1")).not.toBe(
      syntheticEpisodeIdForMessageTurn("ws-2", "m-1")
    );
  });
});

describe("syntheticEpisodeIdForDocument", () => {
  it("returns the same id for (workspace, sourceKind, sourceRef)", () => {
    const a = syntheticEpisodeIdForDocument("ws-1", "kb", "doc-42");
    const b = syntheticEpisodeIdForDocument("ws-1", "kb", "doc-42");
    expect(a).toBe(b);
  });

  it("differs across source kinds", () => {
    expect(syntheticEpisodeIdForDocument("ws-1", "kb", "x")).not.toBe(
      syntheticEpisodeIdForDocument("ws-1", "webhook", "x")
    );
  });

  it("differs from a message-turn id with the same name composition", () => {
    // Defense against namespace collision — even if a caller crafted
    // colliding name strings, the namespace separation should make
    // the ids distinct.
    expect(syntheticEpisodeIdForDocument("ws-1", "kb", "x")).not.toBe(
      syntheticEpisodeIdForMessageTurn("ws-1", "kb\x00x")
    );
  });
});

describe("syntheticEpisodeIdForDay", () => {
  it("accepts a YYYY-MM-DD string", () => {
    const id = syntheticEpisodeIdForDay("ws-1", "2026-05-30");
    expect(id).toMatch(UUID_REGEX);
  });

  it("accepts a Date and uses the UTC day", () => {
    const d = new Date("2026-05-30T12:34:56Z");
    expect(syntheticEpisodeIdForDay("ws-1", d)).toBe(
      syntheticEpisodeIdForDay("ws-1", "2026-05-30")
    );
  });

  it("buckets the entire UTC day into one id", () => {
    const morning = new Date("2026-05-30T00:00:01Z");
    const night = new Date("2026-05-30T23:59:59Z");
    expect(syntheticEpisodeIdForDay("ws-1", morning)).toBe(syntheticEpisodeIdForDay("ws-1", night));
  });

  it("differs across days", () => {
    expect(syntheticEpisodeIdForDay("ws-1", "2026-05-30")).not.toBe(
      syntheticEpisodeIdForDay("ws-1", "2026-05-31")
    );
  });

  it("throws on a malformed day string", () => {
    expect(() => syntheticEpisodeIdForDay("ws-1", "May 30 2026")).toThrow(/expected YYYY-MM-DD/);
  });
});

// ── deriveSyntheticEpisodeId precedence ─────────────────────────────────────

describe("deriveSyntheticEpisodeId", () => {
  it("requires workspaceId", () => {
    expect(() => deriveSyntheticEpisodeId({ workspaceId: "" })).toThrow(/workspaceId required/);
  });

  it("dispatches to message-turn when messageUuid is present", () => {
    const direct = syntheticEpisodeIdForMessageTurn("ws-1", "m-1");
    const derived = deriveSyntheticEpisodeId({ workspaceId: "ws-1", messageUuid: "m-1" });
    expect(derived).toBe(direct);
  });

  it("dispatches to document when sourceKind + sourceRef are present (no message)", () => {
    const direct = syntheticEpisodeIdForDocument("ws-1", "kb", "doc-1");
    const derived = deriveSyntheticEpisodeId({
      workspaceId: "ws-1",
      sourceKind: "kb",
      sourceRef: "doc-1",
    });
    expect(derived).toBe(direct);
  });

  it("dispatches to day when only `day` is present", () => {
    const direct = syntheticEpisodeIdForDay("ws-1", "2026-05-30");
    const derived = deriveSyntheticEpisodeId({ workspaceId: "ws-1", day: "2026-05-30" });
    expect(derived).toBe(direct);
  });

  it("prefers message-turn over document when both are provided", () => {
    const derived = deriveSyntheticEpisodeId({
      workspaceId: "ws-1",
      messageUuid: "m-1",
      sourceKind: "kb",
      sourceRef: "doc-1",
    });
    expect(derived).toBe(syntheticEpisodeIdForMessageTurn("ws-1", "m-1"));
  });

  it("throws when no derivation input is present (anti-NOW fallback)", () => {
    // The contract explicitly forbids a silent "use now" fallback —
    // callers must pass a day if they have nothing else.
    expect(() => deriveSyntheticEpisodeId({ workspaceId: "ws-1" })).toThrow(/requires one of/);
  });
});
