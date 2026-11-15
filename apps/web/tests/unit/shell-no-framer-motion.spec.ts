import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SHELL = path.resolve(__dirname, "../../components/shell");

describe("shell chrome is framer-motion-free (PERF-9)", () => {
  for (const file of ["Sidebar.tsx", "Topbar.tsx"]) {
    it(`${file} does not import framer-motion`, () => {
      const src = fs.readFileSync(path.join(SHELL, file), "utf8");
      expect(src).not.toMatch(/from\s+["']framer-motion["']/);
      expect(src).not.toMatch(/from\s+["']@\/lib\/motion["']/);
      // No JSX motion.* elements left behind.
      expect(src).not.toMatch(/<motion\./);
      expect(src).not.toMatch(/<AnimatePresence/);
    });
  }
});
