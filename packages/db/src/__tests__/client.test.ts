import { describe, it, expect } from "vitest";
import { createDbClient } from "../client";

describe("createDbClient", () => {
  it("returns a drizzle instance given a connection string", () => {
    const db = createDbClient("postgresql://orchester:orchester@localhost:5432/orchester");
    expect(db).toBeDefined();
    expect(typeof db.select).toBe("function");
  });

  it("throws if connection string is empty", () => {
    expect(() => createDbClient("")).toThrow("DATABASE_URL is required");
  });
});
