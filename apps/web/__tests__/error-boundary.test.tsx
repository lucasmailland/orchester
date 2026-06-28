import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const captured: unknown[] = [];
vi.mock("@/lib/observability", () => ({
  captureException: (e: unknown) => captured.push(e),
}));

import { ErrorBoundary } from "@/components/common/ErrorBoundary";

function Boom(): never {
  throw new Error("render boom");
}

describe("ErrorBoundary", () => {
  it("renders fallback and reports to Sentry on a child render crash", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary fallback={<div data-testid="fallback">broke</div>}>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByTestId("fallback")).toBeInTheDocument();
    expect(captured.length).toBeGreaterThanOrEqual(1);
    spy.mockRestore();
  });

  it("renders children normally when there is no crash", () => {
    render(
      <ErrorBoundary>
        <div data-testid="child">ok</div>
      </ErrorBoundary>
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});
