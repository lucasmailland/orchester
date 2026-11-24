import { afterEach, describe, expect, it, vi } from "vitest";
import { _setResolverForTests } from "@/lib/net-guard";

const pg = vi.hoisted(() =>
  vi.fn(() => ({
    begin: async () => [],
    end: async () => undefined,
  }))
);
vi.mock("postgres", () => ({ default: pg }));

import { getConnector, sslFor } from "@/lib/integrations/registry";

const CS = "postgres://u:p@db.example.com:5432/x?sslmode=require";

afterEach(() => {
  _setResolverForTests(undefined);
  pg.mockClear();
});

describe("sslFor", () => {
  it("keeps libpq semantics and adds the servername", () => {
    expect(sslFor(CS, "db.example.com")).toEqual({
      servername: "db.example.com",
      rejectUnauthorized: false,
    });
    expect(sslFor(CS.replace("require", "verify-full"), "db.example.com")).toEqual({
      servername: "db.example.com",
      rejectUnauthorized: true,
    });
    expect(sslFor(CS.replace("require", "verify-ca"), "db.example.com")).toMatchObject({
      rejectUnauthorized: true,
    });
    expect(sslFor(CS.replace("require", "disable"), "db.example.com")).toBe(false);
  });
});

describe("postgres connector", () => {
  it("connects to the address it validated, keeping the name for TLS", async () => {
    _setResolverForTests(async () => [{ address: "93.184.216.34", family: 4 }]);
    await getConnector("postgres")!.actions.query!.run(
      { connectionString: CS },
      { sql: "select 1" }
    );
    expect(pg).toHaveBeenCalledWith(
      CS,
      expect.objectContaining({
        host: "93.184.216.34",
        ssl: expect.objectContaining({ servername: "db.example.com" }),
      })
    );
  });
});
