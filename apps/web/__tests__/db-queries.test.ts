import { describe, it, expect, vi } from "vitest";

vi.mock("@orchester/db", () => ({
  getDb: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
  })),
  schema: {
    teams: { workspaceId: "workspaceId", id: "id" },
    agents: {
      workspaceId: "workspaceId",
      status: "status",
      teamId: "teamId",
      createdAt: "createdAt",
    },
    employees: { workspaceId: "workspaceId", active: "active" },
    conversations: {
      workspaceId: "workspaceId",
      startedAt: "startedAt",
      status: "status",
      durationSeconds: "durationSeconds",
    },
    channels: { workspaceId: "workspaceId" },
    messages: {},
  },
  createDbClient: vi.fn(),
}));

import {
  getDashboardStats,
  getTeams,
  getAgents,
  getEmployees,
  getConversations,
} from "../lib/db-queries";

describe("db-queries exports", () => {
  it("getDashboardStats is a function", () => {
    expect(typeof getDashboardStats).toBe("function");
  });

  it("getTeams is a function", () => {
    expect(typeof getTeams).toBe("function");
  });

  it("getAgents is a function", () => {
    expect(typeof getAgents).toBe("function");
  });

  it("getEmployees is a function", () => {
    expect(typeof getEmployees).toBe("function");
  });

  it("getConversations is a function", () => {
    expect(typeof getConversations).toBe("function");
  });
});
