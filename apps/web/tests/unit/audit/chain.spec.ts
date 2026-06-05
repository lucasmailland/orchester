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
import { canonicalize, computePayloadHash, computeChainHash } from "@/lib/audit/chain";
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
