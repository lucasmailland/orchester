import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");

describe("brain/facts POST — poisoning rejection contract", () => {
  it("imports PoisoningRejectedError from the mnemo package", async () => {
    const src = await readFile(
      resolve(REPO_ROOT, "apps/web/app/api/workspaces/[slug]/brain/facts/route.ts"),
      "utf8"
    );
    expect(src).toContain('from "@orchester/mnemosyne"');
    expect(src).toContain("PoisoningRejectedError");
  });

  it("returns 422 with structured findings on poisoning reject", async () => {
    const src = await readFile(
      resolve(REPO_ROOT, "apps/web/app/api/workspaces/[slug]/brain/facts/route.ts"),
      "utf8"
    );
    expect(src).toMatch(/status:\s*422/);
    expect(src).toContain('"poisoning_rejected"');
    expect(src).toContain("e.scan.findings");
    expect(src).toContain("e.scan.bytes");
  });

  it("emits an audit event keyed by MNEMO_REJECT_POISONING", async () => {
    const src = await readFile(
      resolve(REPO_ROOT, "apps/web/app/api/workspaces/[slug]/brain/facts/route.ts"),
      "utf8"
    );
    expect(src).toContain("MNEMO_REJECT_POISONING");
    expect(src).toContain('"mnemo.fact.rejected_poisoning"');
    expect(src).toContain('"mnemo.fact.poisoning_shadow_hit"');
    expect(src).toContain("appendAudit");
  });
});
