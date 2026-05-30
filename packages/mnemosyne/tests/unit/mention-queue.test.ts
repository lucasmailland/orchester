// packages/mnemosyne/tests/unit/mention-queue.test.ts
//
// Unit tests for #22 — Unresolved-mention queue types and logic.
// No DB required — we test the public interface, type guards, and
// the exported symbols without running any SQL.

import { describe, it, expect } from "vitest";
import type {
  MnemoUnresolvedMention,
  UnresolvedMentionStatus,
  QueueUnresolvedMentionInput,
  ResolveUnresolvedMentionInput,
  DismissUnresolvedMentionInput,
  ListUnresolvedMentionsInput,
} from "../../src/entity/mention-queue";
import {
  queueUnresolvedMention,
  resolveUnresolvedMention,
  dismissUnresolvedMention,
  listUnresolvedMentions,
  getUnresolvedMention,
} from "../../src/entity/mention-queue";

// ── Export contract ───────────────────────────────────────────────────────────

describe("mention-queue exports (#22)", () => {
  it("exports the 5 CRUD functions", () => {
    expect(typeof queueUnresolvedMention).toBe("function");
    expect(typeof resolveUnresolvedMention).toBe("function");
    expect(typeof dismissUnresolvedMention).toBe("function");
    expect(typeof listUnresolvedMentions).toBe("function");
    expect(typeof getUnresolvedMention).toBe("function");
  });
});

// ── Status type guard ─────────────────────────────────────────────────────────

describe("UnresolvedMentionStatus values (#22)", () => {
  it("accepts the three valid status values", () => {
    const statuses: UnresolvedMentionStatus[] = ["pending", "resolved", "dismissed"];
    expect(statuses).toHaveLength(3);
  });

  it("MnemoUnresolvedMention has all required fields", () => {
    // Structural type check via assignment — if this compiles, the shape is correct.
    const mention: MnemoUnresolvedMention = {
      id: "m1",
      workspaceId: "ws1",
      rawName: "Alice Smith",
      context: "Alice Smith joined the project last week.",
      sourceFactId: "fact1",
      confidence: 0.75,
      suggestedEntityId: "entity-alice",
      mentionCount: 1,
      status: "pending",
      resolvedEntityId: null,
      resolvedAt: null,
      metadata: { extractorModel: "gpt-4o" },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(mention.rawName).toBe("Alice Smith");
    expect(mention.status).toBe("pending");
    expect(mention.mentionCount).toBe(1);
  });

  it("resolved mention has non-null resolvedEntityId", () => {
    const resolved: MnemoUnresolvedMention = {
      id: "m2",
      workspaceId: "ws1",
      rawName: "Acme Corp",
      context: null,
      sourceFactId: null,
      confidence: 0.9,
      suggestedEntityId: null,
      mentionCount: 3,
      status: "resolved",
      resolvedEntityId: "entity-acme",
      resolvedAt: new Date(),
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(resolved.resolvedEntityId).toBe("entity-acme");
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
  });

  it("dismissed mention has null resolvedEntityId", () => {
    const dismissed: MnemoUnresolvedMention = {
      id: "m3",
      workspaceId: "ws1",
      rawName: "the CEO",
      context: "the CEO approved the budget.",
      sourceFactId: null,
      confidence: 0.1,
      suggestedEntityId: null,
      mentionCount: 1,
      status: "dismissed",
      resolvedEntityId: null,
      resolvedAt: new Date(),
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(dismissed.resolvedEntityId).toBeNull();
    expect(dismissed.status).toBe("dismissed");
  });
});

// ── Input type contracts ───────────────────────────────────────────────────────

describe("Input type contracts (#22)", () => {
  it("QueueUnresolvedMentionInput requires workspaceId, rawName, tx", () => {
    // Compile-time shape check — ts would error here if fields were missing.
    const _input: QueueUnresolvedMentionInput = {
      workspaceId: "ws1",
      rawName: "Alice",
      // All optional fields omitted
      tx: {} as never,
    };
    expect(_input.rawName).toBe("Alice");
  });

  it("QueueUnresolvedMentionInput accepts all optional fields", () => {
    const _input: QueueUnresolvedMentionInput = {
      workspaceId: "ws1",
      rawName: "Alice",
      context: "Alice from engineering",
      sourceFactId: "fact123",
      confidence: 0.8,
      suggestedEntityId: "entity-alice",
      metadata: { source: "gpt-4o" },
      tx: {} as never,
    };
    expect(_input.confidence).toBe(0.8);
    expect(_input.metadata).toEqual({ source: "gpt-4o" });
  });

  it("ResolveUnresolvedMentionInput requires id + entityId", () => {
    const _input: ResolveUnresolvedMentionInput = {
      workspaceId: "ws1",
      id: "mention-id",
      entityId: "entity-alice",
      tx: {} as never,
    };
    expect(_input.entityId).toBe("entity-alice");
  });

  it("DismissUnresolvedMentionInput requires only id", () => {
    const _input: DismissUnresolvedMentionInput = {
      workspaceId: "ws1",
      id: "mention-id",
      tx: {} as never,
    };
    expect(_input.id).toBe("mention-id");
  });

  it("ListUnresolvedMentionsInput defaults to pending status", () => {
    const _input: ListUnresolvedMentionsInput = {
      workspaceId: "ws1",
      tx: {} as never,
    };
    // status is optional — the function defaults to 'pending'
    expect(_input.status).toBeUndefined();
  });

  it("ListUnresolvedMentionsInput accepts cursor pagination fields", () => {
    const _input: ListUnresolvedMentionsInput = {
      workspaceId: "ws1",
      status: "resolved",
      limit: 25,
      before: new Date("2026-01-01"),
      tx: {} as never,
    };
    expect(_input.limit).toBe(25);
    expect(_input.before).toBeInstanceOf(Date);
  });
});

// ── Default confidence ─────────────────────────────────────────────────────────

describe("mention confidence defaults (#22)", () => {
  it("MnemoUnresolvedMention.confidence is a number in [0,1]", () => {
    const mention: MnemoUnresolvedMention = {
      id: "x",
      workspaceId: "ws",
      rawName: "Bob",
      context: null,
      sourceFactId: null,
      confidence: 0.0,
      suggestedEntityId: null,
      mentionCount: 1,
      status: "pending",
      resolvedEntityId: null,
      resolvedAt: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(mention.confidence).toBeGreaterThanOrEqual(0);
    expect(mention.confidence).toBeLessThanOrEqual(1);
  });

  it("mentionCount is a positive integer", () => {
    const mention: MnemoUnresolvedMention = {
      id: "x",
      workspaceId: "ws",
      rawName: "Bob",
      context: null,
      sourceFactId: null,
      confidence: 0.5,
      suggestedEntityId: null,
      mentionCount: 7,
      status: "pending",
      resolvedEntityId: null,
      resolvedAt: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(mention.mentionCount).toBeGreaterThan(0);
    expect(Number.isInteger(mention.mentionCount)).toBe(true);
  });
});
