// apps/web/tests/integration/security/api-key-scopes.spec.ts
//
// SEC-7: verify that /v1/* routes enforce API-key scopes. A key with only
// "flows:read" scope must get 403 from GET /v1/agents; a key with
// "agents:read" scope must get 200.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        ...init,
        headers: { "content-type": "application/json" },
      }),
  },
}));

import { setupIsolation, teardownIsolation, type IsolationFixture } from "../../isolation/helpers";
import { teardownTestWorkspaces } from "../../fixtures/workspaces";
import { createId } from "@paralleldrive/cuid2";
import { generateApiKey } from "@/lib/api-auth/key";

let f: IsolationFixture;
let agentsReadKey = "";
let flowsReadKey = "";

beforeAll(async () => {
  f = await setupIsolation();
  const a = generateApiKey();
  const fl = generateApiKey();
  agentsReadKey = a.plain;
  flowsReadKey = fl.plain;
  await f.sql.unsafe(
    `INSERT INTO api_key (id, workspace_id, name, hashed_key, prefix, scopes)
     VALUES ($1,$2,'agents-read',$3,'ok_live_a','["agents:read"]'::jsonb)`,
    [createId(), f.wsA.id, a.hashed]
  );
  await f.sql.unsafe(
    `INSERT INTO api_key (id, workspace_id, name, hashed_key, prefix, scopes)
     VALUES ($1,$2,'flows-read',$3,'ok_live_f','["flows:read"]'::jsonb)`,
    [createId(), f.wsA.id, fl.hashed]
  );
}, 90_000);

afterAll(async () => {
  await teardownIsolation(f);
  await teardownTestWorkspaces();
});

describe("SEC-7: /v1/agents enforces agents:read scope", () => {
  it("rejects a flows-only key with 403", async () => {
    const { GET } = await import("@/app/api/v1/agents/route");
    const res = await GET(
      new Request("http://x/v1/agents", {
        headers: { authorization: `Bearer ${flowsReadKey}` },
      })
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("agents:read");
  });

  it("allows an agents:read key with 200", async () => {
    const { GET } = await import("@/app/api/v1/agents/route");
    const res = await GET(
      new Request("http://x/v1/agents", {
        headers: { authorization: `Bearer ${agentsReadKey}` },
      })
    );
    expect(res.status).toBe(200);
  });
});
