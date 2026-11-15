/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// A slug is present in the URL, but the workspace list hasn't loaded yet.
vi.mock("next/navigation", () => ({
  useParams: () => ({ workspaceSlug: "acme-inc" }),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/en/acme-inc/agents",
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
// Empty list = mid-hydration (SWR hasn't resolved).
vi.mock("@/components/workspace/hooks/useMyWorkspaces", () => ({
  useMyWorkspaces: () => ({ workspaces: [], isLoading: true }),
}));

import { WorkspaceSwitcher } from "@/components/workspace/WorkspaceSwitcher";

afterEach(cleanup);

describe("WorkspaceSwitcher hard-nav flash (PERF-23)", () => {
  it("does NOT show 'Select workspace' when a slug is present but the list is still loading", () => {
    render(<WorkspaceSwitcher />);
    expect(screen.queryByText(/select workspace/i)).toBeNull();
    // Falls back to the slug we already know from the URL (name + slug slots both show it).
    expect(screen.getAllByText("acme-inc").length).toBeGreaterThan(0);
  });
});
