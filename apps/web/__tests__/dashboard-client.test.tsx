import { act, cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import type { FullDashboardStats } from "@/lib/db-queries";

// recharts measures its container, which jsdom cannot do; the labels around
// the charts are what is under test.
vi.mock("recharts", () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const Nothing = () => null;
  return {
    ResponsiveContainer: Box,
    ComposedChart: Box,
    BarChart: Box,
    AreaChart: Box,
    PieChart: Box,
    Pie: Box,
    Bar: Box,
    Line: Nothing,
    Area: Nothing,
    Cell: Nothing,
    XAxis: Nothing,
    YAxis: Nothing,
    CartesianGrid: Nothing,
    Tooltip: Nothing,
  };
});

const READ_AT = new Date("2026-03-20T12:00:00.000Z");

function statsWith(overrides: Partial<FullDashboardStats> = {}): FullDashboardStats {
  return {
    generatedAt: READ_AT.toISOString(),
    activeAgents: 2,
    totalAgents: 3,
    conversationsToday: 1,
    conversationsYesterday: 1,
    openConversations: 1,
    escalatedCount: 0,
    totalEmployees: 4,
    avgDurationSeconds: 533,
    activeTeams: 1,
    totalTokensMonth: 3145,
    totalTokensLastMonth: 1000,
    totalCostMonth: 0.161,
    totalCostLastMonth: 0.1,
    conversationsMonth: 3,
    conversationsLastMonth: 2,
    avgTokensPerConv: 450,
    avgCostPerConv: 0.011333,
    flowRunsMonth: 7,
    flowRunsLastMonth: 0,
    flowCostMonth: 0.12,
    flowTokensMonth: 1600,
    activityByDay: [{ date: "2026-03-10", conversations: 1, tokens: 550 }],
    agentUsage: [
      {
        id: "ag1",
        name: "Front desk bot",
        model: "model-a",
        status: "active",
        conversations: 2,
        tokens: 1750,
        costUsd: 0.061,
        tokensPerConv: 275,
      },
    ],
    flowStepUsage: { tokens: 400, costUsd: 0.07 },
    otherUsage: { tokens: 105, costUsd: 0.003 },
    channelDistribution: [],
    statusDistribution: [],
    teamStats: [],
    topEmployees: [],
    hourlyDist: Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 })),
    recentConversations: [],
    ...overrides,
  };
}

function renderDashboard(stats: FullDashboardStats) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ dashboard: en.dashboard }}>
      <DashboardClient
        stats={stats}
        workspaceName="Team one"
        locale="en"
        workspaceSlug="team-one"
      />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(READ_AT.getTime() + 12_000));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DashboardClient — month comparison", () => {
  it("compares this month with last month, never with 'this month'", () => {
    renderDashboard(statsWith());
    const tokens = screen.getByRole("group", { name: "Tokens this month" });
    expect(tokens).toHaveTextContent("+215%");
    expect(tokens).toHaveTextContent("vs last month");
    const conversations = screen.getByRole("group", { name: "Conversations / month" });
    expect(conversations).toHaveTextContent("+50%");
    expect(conversations).toHaveTextContent("vs last month");
    expect(conversations).not.toHaveTextContent("first month");
    expect(screen.queryByText(/vs this month/)).toBeNull();
  });

  it("says 'first month' only when last month is 0", () => {
    renderDashboard(statsWith({ totalTokensLastMonth: 0, conversationsLastMonth: 2 }));
    const tokens = screen.getByRole("group", { name: "Tokens this month" });
    expect(tokens).toHaveTextContent("first month");
    expect(tokens).not.toHaveTextContent("vs last month");
    expect(tokens).not.toHaveTextContent("%");
    const conversations = screen.getByRole("group", { name: "Conversations / month" });
    expect(conversations).not.toHaveTextContent("first month");
    expect(conversations).toHaveTextContent("vs last month");
  });

  it("shows the cost against last month with the conversation spend per conversation", () => {
    renderDashboard(statsWith());
    const cost = screen.getByRole("group", { name: "Model cost" });
    expect(cost).toHaveTextContent("$0.16");
    expect(cost).toHaveTextContent("+61%");
    expect(cost).toHaveTextContent("vs last month");
    expect(cost).toHaveTextContent("$0.011 / conv");
  });
});

describe("DashboardClient — flows", () => {
  it("shows this month's flow runs and their model cost", () => {
    renderDashboard(statsWith());
    const flows = screen.getByRole("group", { name: "Flow runs this month" });
    expect(flows).toHaveTextContent("7");
    expect(flows).toHaveTextContent("$0.12 model cost");
    expect(flows).toHaveTextContent("first month");
  });

  it("lists spend without an agent next to the agents instead of dropping it", () => {
    renderDashboard(statsWith());
    const table = screen.getByRole("region", { name: /Agent performance/ });
    const flowRow = within(table).getByRole("row", { name: /Flow steps \(no agent\)/ });
    expect(flowRow).toHaveTextContent("400");
    expect(flowRow).toHaveTextContent("$0.07");
    // Real prices are often fractions of a cent: not rounded down to $0.00.
    expect(within(table).getByRole("row", { name: /Other/ })).toHaveTextContent("<$0.01");
    const cost = screen.getByRole("region", { name: "Cost per agent" });
    expect(within(cost).getByText("Front desk bot")).toBeInTheDocument();
    expect(within(cost).getByText("Flow steps (no agent)")).toBeInTheDocument();
    expect(within(cost).getByText("$0.16")).toBeInTheDocument();
  });

  it("leaves the extra rows out when there is no such spend", () => {
    renderDashboard(
      statsWith({ flowStepUsage: { tokens: 0, costUsd: 0 }, otherUsage: { tokens: 0, costUsd: 0 } })
    );
    const table = screen.getByRole("region", { name: /Agent performance/ });
    expect(within(table).queryByText("Flow steps (no agent)")).toBeNull();
    expect(within(table).queryByText("Other")).toBeNull();
  });
});

describe("DashboardClient — freshness", () => {
  it("shows when the numbers were read, and keeps counting", () => {
    renderDashboard(statsWith());
    expect(screen.getByText("Updated 12 s ago")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText("Updated 42 s ago")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("Updated 1 min ago")).toBeInTheDocument();
  });

  it("says 'just now' right after a read and no longer claims to be live", () => {
    vi.setSystemTime(new Date(READ_AT.getTime() + 2_000));
    renderDashboard(statsWith());
    expect(screen.getByText("Updated just now")).toBeInTheDocument();
    expect(screen.queryByText("LIVE")).toBeNull();
  });
});
