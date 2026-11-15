import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// WCAG relative-luminance contrast for two "r g b" triplet strings.
function lum([r, g, b]: number[]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
}
function ratio(a: number[], b: number[]): number {
  const sorted = [lum(a), lum(b)].sort((x, y) => y - x);
  const hi = sorted[0]!;
  const lo = sorted[1]!;
  return (hi + 0.05) / (lo + 0.05);
}
function darkToken(css: string, name: string): number[] {
  const dark = css.slice(css.indexOf(".dark"));
  const m = new RegExp(`${name}:\\s*([\\d]+)\\s+([\\d]+)\\s+([\\d]+)`).exec(dark);
  if (!m) throw new Error(`token ${name} not found in .dark`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const css = fs.readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");
const BLACK = [0, 0, 0];
const SURFACE = [9, 9, 11];

describe("dark muted/faint tokens pass WCAG AA (PERF-19)", () => {
  it("text-muted clears 4.5:1 on the darkest surface", () => {
    expect(ratio(darkToken(css, "--text-muted"), BLACK)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(darkToken(css, "--text-muted"), SURFACE)).toBeGreaterThanOrEqual(4.5);
  });
  it("text-faint clears 4.5:1 on the darkest surface", () => {
    expect(ratio(darkToken(css, "--text-faint"), BLACK)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(darkToken(css, "--text-faint"), SURFACE)).toBeGreaterThanOrEqual(4.5);
  });
});
