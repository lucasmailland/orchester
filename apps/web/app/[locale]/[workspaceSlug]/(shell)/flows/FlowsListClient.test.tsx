import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import messages from "../../../../../messages/en.json";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  useParams: () => ({ locale: "en", workspaceSlug: "acme" }),
  redirect: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/common/NoProviderBanner", () => ({ NoProviderBanner: () => null }));

import { FlowsListClient } from "./FlowsListClient";

const flows = [
  {
    id: "flow_a",
    name: "Flow A",
    description: null,
    status: "paused" as const,
    nodeCount: 2,
    lastRunAt: null,
  },
  {
    id: "flow_b",
    name: "Flow B",
    description: null,
    status: "paused" as const,
    nodeCount: 1,
    lastRunAt: null,
  },
];
const clean = {
  flow: { id: "flow_a", name: "Flow A" },
  counts: { runs: 1, versions: 1, webhooks: 0, schedules: 0 },
  blockers: { enabled: false, agents: [], flows: [] },
};

describe("FlowsListClient delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        Promise.resolve(
          new Response(JSON.stringify(init?.method === "DELETE" ? { ok: true } : clean))
        )
      )
    );
  });

  it("removes the card after confirming from its actions menu", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages as unknown as AbstractIntlMessages}>
        <FlowsListClient flows={flows} />
      </NextIntlClientProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: /flow actions: flow a/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /delete flow/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("button", { name: /delete permanently/i }));
    await waitFor(() => expect(screen.queryByText("Flow A")).toBeNull());
    expect(screen.getByText("Flow B")).toBeInTheDocument();
  });
});
