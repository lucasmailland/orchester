import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("channels router is type-checked (CONV-3)", () => {
  it("router.ts no longer suppresses type-checking", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../lib/channels/router.ts"), "utf8");
    expect(src).not.toMatch(/^\s*\/\/\s*@ts-nocheck/m);
  });
});
