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

describe("FlowsListClient AI steps", () => {
  const renderList = (list: Array<(typeof flows)[number] & Record<string, unknown>>) =>
    render(
      <NextIntlClientProvider locale="en" messages={messages as unknown as AbstractIntlMessages}>
        <FlowsListClient flows={list} />
      </NextIntlClientProvider>
    );

  it("shows the AI step count on a card, and nothing when there are none", () => {
    renderList([
      { ...flows[0]!, aiStepCount: 2 },
      { ...flows[1]!, aiStepCount: 0 },
    ]);
    const marks = screen.getAllByTestId("flow-ai-steps");
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent("2 AI steps");
  });

  it("flags AI reached through a sub-flow", () => {
    renderList([{ ...flows[0]!, aiStepCount: 0, aiViaSubflow: true }]);
    expect(screen.getByTestId("flow-ai-steps")).toHaveTextContent("AI via sub-flow");
  });
});

describe("FlowsListClient kind", () => {
  const mixed = [
    { ...flows[0]!, kind: "pipeline" as const },
    { ...flows[1]!, kind: "action" as const },
  ];
  const renderList = () =>
    render(
      <NextIntlClientProvider locale="en" messages={messages as unknown as AbstractIntlMessages}>
        <FlowsListClient flows={mixed} />
      </NextIntlClientProvider>
    );

  it("badges actions only", () => {
    renderList();
    const badges = screen.getAllByTestId("flow-kind-badge");
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent("Action");
    expect(badges[0]!.closest("div")).toHaveTextContent("Flow B");
  });

  it("filters All / Pipelines / Actions", () => {
    renderList();
    const filter = screen.getByRole("group", { name: /filter by type/i });
    expect(within(filter).getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText("Flow A")).toBeInTheDocument();
    expect(screen.getByText("Flow B")).toBeInTheDocument();

    fireEvent.click(within(filter).getByRole("button", { name: "Actions" }));
    expect(screen.queryByText("Flow A")).toBeNull();
    expect(screen.getByText("Flow B")).toBeInTheDocument();

    fireEvent.click(within(filter).getByRole("button", { name: "Pipelines" }));
    expect(screen.getByText("Flow A")).toBeInTheDocument();
    expect(screen.queryByText("Flow B")).toBeNull();

    fireEvent.click(within(filter).getByRole("button", { name: "All" }));
    expect(screen.getByText("Flow B")).toBeInTheDocument();
  });

  it("treats a flow without kind as a pipeline", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages as unknown as AbstractIntlMessages}>
        <FlowsListClient flows={[flows[0]!]} />
      </NextIntlClientProvider>
    );
    expect(screen.queryByTestId("flow-kind-badge")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.queryByText("Flow A")).toBeNull();
    expect(screen.getByText(/no flows of this type/i)).toBeInTheDocument();
  });
});

describe("FlowsListClient relations", () => {
  const rel = {
    usedBy: [],
    uses: [
      {
        flowId: "flow_b",
        name: "Flow B",
        kind: "action" as const,
        ai: true,
        missing: false,
        steps: ["Step"],
      },
    ],
    externalCallers: [],
    webhooks: 1,
    schedules: 0,
  };

  it("shows chips only for flows with relations and opens the details", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages as unknown as AbstractIntlMessages}>
        <FlowsListClient flows={[{ ...flows[0]!, relations: rel }, flows[1]!]} />
      </NextIntlClientProvider>
    );
    expect(screen.getAllByTestId("flow-relations")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /used by 1/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /uses 1/i }));
    const dialog = screen.getByRole("dialog", { name: "Uses" });
    expect(within(dialog).getByRole("link", { name: "Flow B" })).toBeTruthy();
  });
});
