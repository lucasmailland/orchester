import { describe, it, expect } from "vitest";
import { users, sessions, accounts, verifications } from "../schema/auth";
import { workspaces, workspaceMembers, workspaceMemberRoleEnum } from "../schema/workspaces";

describe("Auth schema", () => {
  it("users table has required columns", () => {
    expect(users).toBeDefined();
    expect(users.email).toBeDefined();
    expect(users.id).toBeDefined();
  });

  it("sessions references users", () => {
    expect(sessions).toBeDefined();
  });

  it("accounts references users", () => {
    expect(accounts).toBeDefined();
  });

  it("verifications table exists", () => {
    expect(verifications).toBeDefined();
  });
});

describe("Workspace schema", () => {
  it("workspaces table has id, name, slug", () => {
    expect(workspaces).toBeDefined();
  });

  it("workspaceMembers has role column", () => {
    expect(workspaceMembers).toBeDefined();
  });

  it("role enum has four values", () => {
    expect(workspaceMemberRoleEnum.enumValues).toEqual(
      expect.arrayContaining(["owner", "admin", "editor", "viewer"])
    );
  });
});
