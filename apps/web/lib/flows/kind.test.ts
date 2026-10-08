import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  FLOW_KINDS,
  MAX_EXTERNAL_CALLERS,
  flowKindSchema,
  externalCallersSchema,
  formatExternalCallers,
  readExternalCallers,
} from "./kind";

describe("flow kind schema", () => {
  it("knows the two kinds", () => {
    expect([...FLOW_KINDS]).toEqual(["pipeline", "action"]);
    expect(flowKindSchema.safeParse("action").success).toBe(true);
    expect(flowKindSchema.safeParse("macro").success).toBe(false);
  });

  it("accepts name with an optional note", () => {
    const r = externalCallersSchema.safeParse([
      { name: "nightly-script" },
      { name: "n", note: "x" },
    ]);
    expect(r.success).toBe(true);
  });

  it.each([
    ["empty name", [{ name: "" }]],
    ["name over 80", [{ name: "a".repeat(81) }]],
    ["note over 200", [{ name: "a", note: "b".repeat(201) }]],
    ["missing name", [{ note: "x" }]],
    ["not an array", { name: "a" }],
    ["unknown key", [{ name: "a", url: "x" }]],
  ])("rejects %s", (_l, value) => {
    expect(externalCallersSchema.safeParse(value).success).toBe(false);
  });

  it("caps the list at 10 entries", () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `c${i}` }));
    expect(MAX_EXTERNAL_CALLERS).toBe(10);
    expect(externalCallersSchema.safeParse(mk(10)).success).toBe(true);
    expect(externalCallersSchema.safeParse(mk(11)).success).toBe(false);
  });

  it("formats names for messages", () => {
    expect(formatExternalCallers([{ name: "a" }, { name: "b", note: "n" }])).toBe("a, b");
  });
});

describe("readExternalCallers", () => {
  it("reads a valid list as is", () => {
    expect(readExternalCallers([{ name: "a", note: "n" }])).toEqual([{ name: "a", note: "n" }]);
  });
  it("treats missing or non-array values as empty", () => {
    expect(readExternalCallers(undefined)).toEqual([]);
    expect(readExternalCallers(null)).toEqual([]);
    expect(readExternalCallers({})).toEqual([]);
  });
  it("never lets a malformed entry hide a caller", () => {
    expect(readExternalCallers([{ bogus: 1 }, "x"])).toHaveLength(2);
  });
});

describe("migration 0062", () => {
  const dbDir = resolve(__dirname, "../../../../packages/db");
  const sql = readFileSync(resolve(dbDir, "migrations/0062_flow_kind.sql"), "utf8");

  it("adds both columns idempotently, one ALTER per column", () => {
    expect(sql).toMatch(
      /ALTER TABLE "flow" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'pipeline'/
    );
    expect(sql).toMatch(/CHECK \("kind" IN \('pipeline', ?'action'\)\)/);
    expect(sql).toMatch(
      /ALTER TABLE "flow" ADD COLUMN IF NOT EXISTS "external_callers" jsonb NOT NULL DEFAULT '\[\]'/
    );
  });

  it("is registered in the manifest", () => {
    const manifest = readFileSync(resolve(dbDir, "scripts/manifest.mjs"), "utf8");
    expect(manifest).toContain('"0062_flow_kind.sql"');
  });

  it("is mirrored in the drizzle schema", () => {
    const schema = readFileSync(resolve(dbDir, "src/schema/flows.ts"), "utf8");
    expect(schema).toMatch(/text\("kind"/);
    expect(schema).toContain('jsonb("external_callers")');
  });
});
