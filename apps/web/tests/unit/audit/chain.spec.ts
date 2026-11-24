// apps/web/tests/unit/audit/chain.spec.ts
//
// Spec: docs/specs/2026-05-23-tenant-hardening-design.md §3.4
// Plan: Task A.17
//
// Pure unit tests for the audit log hash primitives. No DB required —
// canonicalize/computePayloadHash/computeChainHash must produce stable,
// deterministic outputs so the chain can be reconstructed and verified
// from raw rows.
import { describe, it, expect } from "vitest";
import {
  canonicalize,
  computePayloadHash,
  computeChainHash,
  computePayloadHashV2,
  computeChainHashV2,
  auditKey,
} from "@/lib/audit/chain";
import { createHmac, hkdfSync } from "crypto";
import * as fc from "fast-check";

describe("canonicalize", () => {
  it("produces stable output regardless of key order", () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
  });

  it("recurses into nested objects with stable order", () => {
    expect(canonicalize({ x: { c: 3, a: 1, b: 2 } })).toBe(
      canonicalize({ x: { a: 1, b: 2, c: 3 } })
    );
  });

  it("preserves array order (arrays are ordered)", () => {
    expect(canonicalize([1, 2, 3])).toBe("[1,2,3]");
    expect(canonicalize([1, 2, 3])).not.toBe(canonicalize([3, 2, 1]));
  });

  it("handles null", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize({ a: null })).toBe('{"a":null}');
  });
});

describe("computePayloadHash", () => {
  const base = {
    action: "workspace.create" as const,
    actorUserId: "usr_1",
    actorKind: "user",
    targetType: "workspace",
    targetId: "ws_1",
    meta: { name: "Acme" },
    createdAt: new Date("2026-05-23T10:00:00Z"),
  };

  it("is deterministic", () => {
    expect(computePayloadHash(base)).toBe(computePayloadHash({ ...base }));
  });

  it("is 64-char hex (sha256)", () => {
    expect(computePayloadHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any field changes", () => {
    const ref = computePayloadHash(base);
    expect(computePayloadHash({ ...base, action: "workspace.update" })).not.toBe(ref);
    expect(computePayloadHash({ ...base, meta: { name: "Other" } })).not.toBe(ref);
    expect(
      computePayloadHash({
        ...base,
        createdAt: new Date(base.createdAt.getTime() + 1),
      })
    ).not.toBe(ref);
  });

  it("collision-resistant for arbitrary perturbations (200 random cases)", () => {
    fc.assert(
      fc.property(
        fc.record({
          a: fc.string({ minLength: 1, maxLength: 10 }),
          b: fc.integer(),
        }),
        (meta) => {
          const h1 = computePayloadHash({ ...base, meta });
          const h2 = computePayloadHash({
            ...base,
            meta: { ...meta, a: meta.a + "x" },
          });
          expect(h1).not.toBe(h2);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe("computeChainHash", () => {
  it("uses zero hash for null prev (genesis)", () => {
    expect(computeChainHash(null, "a".repeat(64), BigInt(1))).toBe(
      computeChainHash("0".repeat(64), "a".repeat(64), BigInt(1))
    );
  });

  it("varies with seq", () => {
    expect(computeChainHash(null, "a".repeat(64), BigInt(1))).not.toBe(
      computeChainHash(null, "a".repeat(64), BigInt(2))
    );
  });

  it("produces 64-char hex", () => {
    expect(computeChainHash(null, "a".repeat(64), BigInt(1))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("v2 (HMAC) hashes", () => {
  const SECRET = "ab".repeat(32);
  const base = {
    workspaceId: "ws_1",
    action: "workspace.update",
    actorUserId: "usr_1",
    actorKind: "user",
    actorIp: "10.0.0.1",
    actorUserAgent: "ua/1",
    targetType: "workspace",
    targetId: "ws_1",
    meta: { a: 1 },
    createdAt: new Date("2026-11-23T10:00:00Z"),
  };

  it("auditKey is hkdf(sha256, ENCRYPTION_SECRET, 'orchester', 'audit-log-v1', 32)", () => {
    const prev = process.env.ENCRYPTION_SECRET;
    process.env.ENCRYPTION_SECRET = SECRET;
    try {
      const expected = Buffer.from(
        hkdfSync("sha256", Buffer.from(SECRET, "hex"), "orchester", "audit-log-v1", 32)
      );
      expect(auditKey().equals(expected)).toBe(true);
    } finally {
      process.env.ENCRYPTION_SECRET = prev;
    }
  });

  it("auditKey is memoized per secret value", () => {
    const prev = process.env.ENCRYPTION_SECRET;
    try {
      process.env.ENCRYPTION_SECRET = SECRET;
      const k1 = auditKey();
      expect(auditKey()).toBe(k1);
      process.env.ENCRYPTION_SECRET = "cd".repeat(32);
      expect(auditKey().equals(k1)).toBe(false);
    } finally {
      process.env.ENCRYPTION_SECRET = prev;
    }
  });

  it("auditKey throws without a valid ENCRYPTION_SECRET", () => {
    const prev = process.env.ENCRYPTION_SECRET;
    process.env.ENCRYPTION_SECRET = "short";
    try {
      expect(() => auditKey()).toThrow(/ENCRYPTION_SECRET/);
    } finally {
      process.env.ENCRYPTION_SECRET = prev;
    }
  });

  it("payload hash covers workspace_id, actor_ip and actor_user_agent", () => {
    const ref = computePayloadHashV2(base);
    expect(computePayloadHashV2({ ...base, workspaceId: "ws_2" })).not.toBe(ref);
    expect(computePayloadHashV2({ ...base, actorIp: "10.0.0.2" })).not.toBe(ref);
    expect(computePayloadHashV2({ ...base, actorIp: null })).not.toBe(ref);
    expect(computePayloadHashV2({ ...base, actorUserAgent: "ua/2" })).not.toBe(ref);
  });

  it("chain hash is an HMAC, not the unkeyed v1 sha256", () => {
    const key = Buffer.alloc(32, 7);
    const p = "a".repeat(64);
    const h = computeChainHashV2(key, null, p, BigInt(1));
    expect(h).toBe(
      createHmac("sha256", key)
        .update(`${"0".repeat(64)}|${p}|1`)
        .digest("hex")
    );
    expect(h).not.toBe(computeChainHash(null, p, BigInt(1)));
    expect(h).not.toBe(computeChainHashV2(Buffer.alloc(32, 8), null, p, BigInt(1)));
  });
});
