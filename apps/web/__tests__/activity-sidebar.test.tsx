import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";

vi.mock("next/navigation", () => ({
  useParams: () => ({ workspaceSlug: "team-one" }),
  usePathname: () => "/en/team-one",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/workspace/WorkspaceSwitcher", () => ({ WorkspaceSwitcher: () => null }));

import { Sidebar } from "@/components/shell/Sidebar";

afterEach(cleanup);

function renderSidebar(showActivity: boolean) {
  render(
    <NextIntlClientProvider locale="en" messages={{ nav: en.nav }}>
      <Sidebar locale="en" showActivity={showActivity} />
    </NextIntlClientProvider>
  );
}

describe("Sidebar activity item", () => {
  it("links to the activity page in the System group when the role may see it", () => {
    renderSidebar(true);
    expect(screen.getByRole("link", { name: /Activity/ })).toHaveAttribute(
      "href",
      "/en/team-one/activity"
    );
  });

  it("is absent for roles that may not see it", () => {
    renderSidebar(false);
    expect(screen.queryByRole("link", { name: /Activity/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Settings/ })).toBeInTheDocument();
  });
});
