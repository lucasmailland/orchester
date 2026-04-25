import { describe, it, expect } from "vitest";
import {
  fadeIn,
  fadeInUp,
  staggerContainer,
  scaleIn,
  cardHover,
} from "../lib/motion";

describe("Motion variants", () => {
  it("fadeIn has hidden and visible states with opacity", () => {
    expect(fadeIn.hidden).toBeDefined();
    expect(fadeIn.visible).toBeDefined();
    expect((fadeIn.hidden as { opacity: number }).opacity).toBe(0);
    expect((fadeIn.visible as { opacity: number }).opacity).toBe(1);
  });

  it("fadeInUp moves element from below", () => {
    const hidden = fadeInUp.hidden as { opacity: number; y: number };
    const visible = fadeInUp.visible as { opacity: number; y: number };
    expect(hidden.y).toBeGreaterThan(0);
    expect(visible.y).toBe(0);
    expect(visible.opacity).toBe(1);
  });

  it("staggerContainer has staggerChildren", () => {
    const visible = staggerContainer.visible as {
      transition: { staggerChildren: number };
    };
    expect(visible.transition.staggerChildren).toBeGreaterThan(0);
  });

  it("cardHover has rest and hover states", () => {
    expect(cardHover.rest).toBeDefined();
    expect(cardHover.hover).toBeDefined();
  });

  it("scaleIn starts below scale 1", () => {
    const hidden = scaleIn.hidden as { scale: number };
    expect(hidden.scale).toBeLessThan(1);
  });
});
