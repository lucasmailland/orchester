import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import { ActivityClient } from "@/components/activity/ActivityClient";
import type { ActivityResponse, ActivityRow, ActivityTotals } from "@/lib/activity/types";

const toolRow: ActivityRow = {
  id: "tc1",
  at: "2026-03-09T10:00:00.000500Z",
  kind: "tool_call",
  agent: { id: "ag1", name: "Helper bot" },
  flow: null,
  channel: { id: "ch1", name: "Front desk" },
  integration: { type: "mcp", id: "int1", name: "Data source" },
  ref: null,
  outcome: "error",
  tokens: null,
  costUsd: null,
  durationMs: 120,
  summary: "mcp__int1__lookup_people",
  link: "/conversations/cv1",
  detail: {
    kind: "tool_call",
    source: "channel",
    tool: "mcp__int1__lookup_people",
    input: { department: "finance" },
    errorCode: "TIMEOUT",
    error: "remote did not answer",
    resultSize: null,
    conversationId: "cv1",
    flowRunId: null,
    nodeId: null,
  },
};

const usageRow: ActivityRow = {
  id: "ue1",
  at: "2026-03-09T09:00:00.000000Z",
  kind: "model_usage",
  agent: { id: "ag1", name: "Helper bot" },
  flow: null,
  channel: null,
  integration: null,
  ref: null,
  outcome: null,
  tokens: { in: 1000, out: 250, cacheWrite: null, cacheRead: null, total: 1250 },
  costUsd: 0.0123,
  durationMs: null,
  summary: "model-x · chat",
  link: null,
  detail: {
    kind: "model_usage",
    usageKind: "tokens_out",
    model: "model-x",
    capability: "chat",
    failed: false,
    conversationId: null,
    flowRunId: null,
    nodeId: null,
  },
};

const counts = { total: 1, ok: 0, error: 1, refused: 0 };
const totals: ActivityTotals = {
  counts: { tool_call: 1, model_usage: 1, flow_run: 0, conversation: 0, config_change: 0 },
  toolCalls: counts,
  toolCallsByTool: [{ tool: "mcp__int1__lookup_people", ...counts }],
  toolCallsByAgent: [{ agent: { id: "ag1", name: "Helper bot" }, ...counts }],
  toolCallsByIntegration: [
    { integration: { type: "mcp", id: "int1", name: "Data source" }, ...counts },
  ],
  usage: {
    events: 1,
    costUsd: 0.0123,
    tokens: { in: 1000, out: 250, cacheWrite: 0, cacheRead: 0, total: 1250 },
  },
  usageByAgent: [
    {
      agent: { id: "ag1", name: "Helper bot" },
      events: 1,
      costUsd: 0.0123,
      tokens: { in: 1000, out: 250, cacheWrite: 0, cacheRead: 0, total: 1250 },
    },
  ],
  usageByFlow: [],
};

const options = {
  agents: [{ id: "ag1", name: "Helper bot" }],
  flows: [{ id: "fl1", name: "Nightly sync" }],
  channels: [],
  integrations: [{ id: "int1", name: "Data source", type: "mcp" }],
};

let fetchMock: ReturnType<typeof vi.fn>;
let pages: Record<string, ActivityResponse>;

function urlOf(call: unknown[]): URL {
  return new URL(String(call[0]), "http://localhost");
}

beforeEach(() => {
  pages = {
    first: { rows: [toolRow], nextCursor: "c1", totals },
    c1: { rows: [usageRow], nextCursor: null, totals: null },
  };
  fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input, "http://localhost");
    const body = pages[url.searchParams.get("cursor") ?? "first"];
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderClient() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ pages: { activity: en.pages.activity } }}>
      <ActivityClient workspaceSlug="team-one" options={options} />
    </NextIntlClientProvider>
  );
}

describe("ActivityClient", () => {
  it("loads the last 7 days and shows rows and totals", async () => {
    renderClient();
    expect(await screen.findByText("mcp__int1__lookup_people")).toBeInTheDocument();
    const url = urlOf(fetchMock.mock.calls[0]!);
    expect(url.pathname).toBe("/api/workspaces/team-one/activity");
    const from = new Date(url.searchParams.get("from")!).getTime();
    const to = new Date(url.searchParams.get("to")!).getTime();
    expect(to - from).toBe(7 * 86_400_000);

    expect(screen.getByRole("group", { name: "Model cost" })).toHaveTextContent("$0.012");
    const byIntegration = screen.getByRole("region", { name: "Calls by integration" });
    expect(within(byIntegration).getByText("Data source")).toBeInTheDocument();
    const costByAgent = screen.getByRole("region", { name: "Cost by agent" });
    expect(within(costByAgent).getByText("Helper bot")).toBeInTheDocument();
    expect(within(costByAgent).getByText("$0.012")).toBeInTheDocument();
  });

  it("links each row to its origin", async () => {
    renderClient();
    const link = await screen.findByRole("link", { name: "Open origin" });
    expect(link).toHaveAttribute("href", "/en/team-one/conversations/cv1");
  });

  it("appends the next page with the cursor", async () => {
    renderClient();
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByText("model-x · chat")).toBeInTheDocument();
    expect(screen.getByText("mcp__int1__lookup_people")).toBeInTheDocument();
    const second = urlOf(fetchMock.mock.calls[1]!);
    expect(second.searchParams.get("cursor")).toBe("c1");
    expect(second.searchParams.get("from")).toBe(
      urlOf(fetchMock.mock.calls[0]!).searchParams.get("from")
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "Load more" })).toBeNull());
  });

  it("expands a row to show the sanitized input and the error", async () => {
    renderClient();
    fireEvent.click(await screen.findByRole("button", { name: "Show details" }));
    expect(screen.getByText("Input (sanitized)")).toBeInTheDocument();
    expect(screen.getByText(/"department": "finance"/)).toBeInTheDocument();
    expect(screen.getByText(/remote did not answer/)).toBeInTheDocument();
  });

  it("narrows to MCP data access with totals by agent and by tool", async () => {
    renderClient();
    await screen.findByText("mcp__int1__lookup_people");
    fireEvent.click(screen.getByRole("tab", { name: "MCP data access" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(urlOf(fetchMock.mock.calls[1]!).searchParams.get("integrationType")).toBe("mcp");
    expect(await screen.findByRole("region", { name: "Calls by agent" })).toBeInTheDocument();
    const byTool = screen.getByRole("region", { name: "Calls by tool" });
    expect(within(byTool).getByText("lookup_people")).toBeInTheDocument();
    // Spend does not apply to a tool-call view: the tiles count agents and tools instead.
    expect(screen.getByRole("group", { name: "Agents" })).toHaveTextContent("1");
    expect(screen.getByRole("group", { name: "Tools" })).toHaveTextContent("1");
    expect(screen.queryByRole("group", { name: "Model cost" })).toBeNull();
  });

  it("shows who made a config change", async () => {
    pages.first = {
      rows: [
        {
          ...usageRow,
          id: "au1",
          kind: "config_change",
          agent: null,
          tokens: null,
          costUsd: null,
          summary: "integration.update · integration:int1",
          link: "/settings#audit",
          detail: {
            kind: "config_change",
            action: "integration.update",
            actor: { kind: "user", userId: "u1", name: "Workspace admin", email: null },
            targetType: "integration",
            targetId: "int1",
            meta: {},
          },
        },
      ],
      nextCursor: null,
      totals,
    };
    renderClient();
    expect(await screen.findByText("Workspace admin")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open origin" })).toHaveAttribute(
      "href",
      "/en/team-one/settings#audit"
    );
  });

  it("refetches when a filter changes and exports with the same filters", async () => {
    renderClient();
    await screen.findByText("mcp__int1__lookup_people");
    fireEvent.change(screen.getByLabelText("Outcome"), { target: { value: "error" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const listed = urlOf(fetchMock.mock.calls[1]!);
    expect(listed.searchParams.get("outcome")).toBe("error");

    const exportLink = screen.getByRole("link", { name: "Export CSV" });
    const href = new URL(exportLink.getAttribute("href")!, "http://localhost");
    expect(href.pathname).toBe("/api/workspaces/team-one/activity/export");
    expect(href.searchParams.get("outcome")).toBe("error");
    expect(href.searchParams.get("from")).toBe(listed.searchParams.get("from"));
    expect(href.searchParams.get("cursor")).toBeNull();
  });

  it("says so when the activity cannot be loaded", async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    renderClient();
    expect(await screen.findByText("Could not load the activity.")).toBeInTheDocument();
  });
});
