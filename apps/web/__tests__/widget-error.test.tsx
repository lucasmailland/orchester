import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const captured: unknown[] = [];
vi.mock("@/lib/observability", () => ({ captureException: (e: unknown) => captured.push(e) }));

import WidgetError from "@/app/widget/error";

describe("WidgetError", () => {
  it("renders a recover button and reports to Sentry", () => {
    const reset = vi.fn();
    render(
      <WidgetError error={new Error("widget boom") as Error & { digest?: string }} reset={reset} />
    );
    expect(screen.getByRole("button")).toBeInTheDocument();
    expect(captured.length).toBeGreaterThanOrEqual(1);
  });
});
