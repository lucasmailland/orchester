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
  const ssl = (mode: string) => sslFor(`postgres://u:p@db.example.com/x${mode}`, "db.example.com");

  it("keeps postgres.js's sslmode semantics and adds the servername where TLS is certain", () => {
    expect(ssl("")).toBe(false);
    expect(ssl("?sslmode=disable")).toBe(false);
    expect(ssl("?sslmode=allow")).toBe("allow");
    expect(ssl("?sslmode=prefer")).toBe("prefer");
    expect(ssl("?sslmode=require")).toEqual({
      servername: "db.example.com",
      rejectUnauthorized: false,
    });
    expect(ssl("?sslmode=verify-ca")).toEqual({
      servername: "db.example.com",
      rejectUnauthorized: true,
    });
    expect(ssl("?sslmode=verify-full")).toEqual({
      servername: "db.example.com",
      rejectUnauthorized: true,
    });
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
