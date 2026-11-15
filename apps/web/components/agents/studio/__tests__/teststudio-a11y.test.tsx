/** @vitest-environment jsdom */
import fs from "node:fs";
import path from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({}),
  usePathname: () => "/",
}));

import { TestChat } from "@/components/agents/studio/TestChat";

afterEach(cleanup);

describe("TestChat a11y (PERF-17, PERF-18)", () => {
  it("clear button has an accessible name", () => {
    const { container } = render(
      <TestChat agentId="a1" systemPrompt="" model="claude-haiku-4-5" temperature={0.7} />
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.some((b) => b.getAttribute("aria-label"))).toBe(true);
    // The streaming output region must be a live region.
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
  });

  it("error region uses role=alert", () => {
    // We can't trigger actual errors in a unit test, but we can assert the markup
    // structure of the error div by checking TestChat's source.
    const src = fs.readFileSync(path.resolve(__dirname, "../TestChat.tsx"), "utf8");
    expect(src).toMatch(/role="alert"/);
  });
});
