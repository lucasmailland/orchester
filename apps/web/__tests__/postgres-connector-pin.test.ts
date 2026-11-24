import { afterEach, describe, expect, it, vi } from "vitest";
import { _setResolverForTests } from "@/lib/net-guard";

const pg = vi.hoisted(() =>
  vi.fn((_cs: string, _opts: Record<string, unknown>) => ({
    begin: async () => [],
    end: async () => undefined,
  }))
);
vi.mock("postgres", () => ({ default: pg }));

import { getConnector, sslFor } from "@/lib/integrations/registry";

const CS = "postgres://u:p@db.example.com:6543/x?sslmode=require";

afterEach(() => {
  _setResolverForTests(undefined);
  vi.unstubAllEnvs();
  pg.mockClear();
});

describe("sslFor", () => {
  const ssl = (q: string) => sslFor(`postgres://u:p@db.example.com/x${q}`, "db.example.com");
  const unverified = { servername: "db.example.com", rejectUnauthorized: false };
  const verified = { servername: "db.example.com", rejectUnauthorized: true };

  it("keeps postgres.js's sslmode semantics and adds the servername where TLS is certain", () => {
    expect(ssl("")).toBe(false);
    expect(ssl("?sslmode=disable")).toBe(false);
    expect(ssl("?sslmode=allow")).toBe("allow");
    expect(ssl("?sslmode=prefer")).toBe("prefer");
    expect(ssl("?sslmode=require")).toEqual(unverified);
    expect(ssl("?sslmode=verify-ca")).toEqual(verified);
    expect(ssl("?sslmode=verify-full")).toEqual(verified);
  });

  it("reads TLS requested by ssl=, sslrootcert=system and PGSSL as postgres.js does", () => {
    expect(ssl("?ssl=true")).toEqual(verified);
    expect(ssl("?ssl=require")).toEqual(unverified);
    expect(ssl("?ssl=false")).toBe(false);
    expect(ssl("?sslrootcert=system")).toEqual(verified);
    expect(ssl("?sslmode=require&sslrootcert=system")).toEqual(verified);
    expect(ssl("?sslmode=disable&ssl=true")).toBe(false); // sslmode wins
    vi.stubEnv("PGSSL", "require");
    expect(ssl("")).toEqual(unverified);
    expect(ssl("?sslmode=disable")).toBe(false); // the string wins over the env
  });
});

describe("postgres connector", () => {
  /** Runs query.run, then feeds the options it built to the real postgres.js parser. */
  async function parsedOptions(address: string, family: number) {
    _setResolverForTests(async () => [{ address, family }]);
    await getConnector("postgres")!.actions.query!.run(
      { connectionString: CS },
      { sql: "select 1" }
    );
    const [cs, opts] = pg.mock.calls[0]!;
    const { default: realPg } = await vi.importActual<{ default: typeof import("postgres") }>(
      "postgres"
    );
    const sql = realPg(cs, opts as never);
    const { host, port, ssl } = sql.options as unknown as {
      host: string[];
      port: number[];
      ssl: unknown;
    };
    await sql.end();
    return { host, port, ssl };
  }

  it("connects to the validated IPv4 address, keeping the name for TLS", async () => {
    expect(await parsedOptions("93.184.216.34", 4)).toEqual({
      host: ["93.184.216.34"],
      port: [6543],
      ssl: { servername: "db.example.com", rejectUnauthorized: false },
    });
  });

  it("keeps a validated IPv6 address whole", async () => {
    expect(await parsedOptions("2606:2800:220:1::1", 6)).toMatchObject({
      host: ["2606:2800:220:1::1"],
      port: [6543],
    });
  });
});
