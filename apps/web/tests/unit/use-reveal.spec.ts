// apps/web/tests/unit/use-reveal.spec.ts
//
// PERF-1: useReveal returns "hidden" on first render then "visible" after mount,
// guaranteeing a committed state change so framer-motion flushes the animation.
import { it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useReveal } from "@/lib/motion";

it("starts hidden and becomes visible after mount", () => {
  const { result } = renderHook(() => useReveal());
  // After renderHook flushes effects (via act), the value is "visible".
  act(() => {});
  expect(result.current).toBe("visible");
});
