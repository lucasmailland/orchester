import { describe, it, expect } from "vitest";
import {
  teams, agents, agentStatusEnum,
  channelTypeEnum,
  employees,
  conversationStatusEnum,
  messages,
} from "../schema/core";

describe("Core schema", () => {
  it("teams table is defined", () => {
    expect(teams).toBeDefined();
    expect(teams.name).toBeDefined();
  });

  it("agents table has status enum", () => {
    expect(agents).toBeDefined();
    expect(agentStatusEnum.enumValues).toEqual(
      expect.arrayContaining(["active", "inactive", "draft"])
    );
  });

  it("channels has type enum", () => {
    expect(channelTypeEnum.enumValues).toEqual(
      expect.arrayContaining(["web", "whatsapp", "telegram"])
    );
  });

  it("employees table is defined", () => {
    expect(employees).toBeDefined();
    expect(employees.email).toBeDefined();
  });

  it("conversations has status enum", () => {
    expect(conversationStatusEnum.enumValues).toEqual(
      expect.arrayContaining(["open", "closed", "escalated"])
    );
  });

  it("messages references conversations", () => {
    expect(messages).toBeDefined();
  });
});
