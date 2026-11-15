import { describe, it, expect } from "vitest";
import { stellarColor, STELLAR_STOPS, edgeIntensity } from "./stellar";

describe("stellarColor", () => {
  it("returns the coolest stop (red dwarf) at centrality 0", () => {
    expect(stellarColor(0)).toBe("#ff6050");
  });

  it("returns the hottest stop (blue giant) at centrality 1", () => {
    expect(stellarColor(1)).toBe("#80a0ff");
  });

  it("clamps out-of-range input", () => {
    expect(stellarColor(-5)).toBe("#ff6050");
    expect(stellarColor(99)).toBe("#80a0ff");
  });

  it("interpolates to a valid 6-digit hex at the midpoint", () => {
    const mid = stellarColor(0.5);
    expect(mid).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("gets brighter (higher luminance) as centrality rises", () => {
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255);
    };
    expect(lum(stellarColor(0.9))).toBeGreaterThan(lum(stellarColor(0.1)));
  });

  it("exposes 7 spectral stops", () => {
    expect(STELLAR_STOPS).toHaveLength(7);
  });
});

describe("edgeIntensity", () => {
  it("is brighter within a community than across", () => {
    expect(edgeIntensity(3, 3)).toBeGreaterThan(edgeIntensity(3, 7));
  });

  it("treats undefined community as cross-community (dim)", () => {
    expect(edgeIntensity(undefined, 2)).toBe(edgeIntensity(1, 2));
  });

  it("returns values in [0,1]", () => {
    for (const v of [edgeIntensity(1, 1), edgeIntensity(1, 2)]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
