// apps/web/tests/isolation/injection-probes.spec.ts
//
// Sanity probes that SQL injection payloads stuffed into a tenant-owned text
// column (here: agent.name) are stored literally instead of executing. Uses
// parameterized queries through postgres-js (pg-style $1 placeholders), so
// any failure indicates a regression in how the driver binds parameters.
//
// We also confirm that after each insert:
//   - the agent table still exists (no DROP succeeded)
//   - the inserted name round-trips byte-for-byte
//   - the GUC injection payload didn't actually re-target the workspace
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupIsolation,
  teardownIsolation,
  withAppUserContext,
  withCronAdminContext,
  type IsolationFixture,
} from "./helpers";
import { teardownTestWorkspaces } from "../fixtures/workspaces";
import { createId } from "@paralleldrive/cuid2";

let f: IsolationFixture;

const PAYLOADS = [
  `'; DROP TABLE agent; --`,
  `' OR '1'='1`,
  `'; SET LOCAL app.workspace_id = 'other_ws'; --`,
  `' UNION SELECT * FROM agent --`,
];

beforeAll(async () => {
  f = await setupIsolation();
}, 60_000);

afterAll(async () => {
  await teardownIsolation(f);
  await teardownTestWorkspaces();
});

describe("SQL injection probes against agent.name", () => {
  it.each(PAYLOADS)("payload %s is stored literally without execution", async (payload) => {
    const id = createId();
    await withAppUserContext(f.sql, f.wsA.id, async (tx) => {
      // Parameterized — the payload bytes go in as a literal, not as SQL.
      await tx.unsafe(
        `INSERT INTO agent (id, workspace_id, name, role, system_prompt, status)
           VALUES ($1, $2, $3, 'iso-injection', 'sp', 'active')`,
        [id, f.wsA.id, payload]
      );
    });

    // Verify schema integrity: agent table still exists with the FK intact.
    const tableCount = await withCronAdminContext(f.sql, async (tx) => {
      return tx.unsafe(
        `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name='agent'`
      );
    });
    expect(tableCount[0]?.["n"]).toBe(1);

    // Verify round-trip: the row we just inserted exists with the exact
    // payload bytes, scoped to wsA (the GUC-injection payload should not
    // have flipped us to a different workspace).
    const found = await withAppUserContext(f.sql, f.wsA.id, async (tx) => {
      return tx.unsafe(`SELECT id, name, workspace_id FROM agent WHERE id=$1`, [id]);
    });
    expect(found).toHaveLength(1);
    expect(found[0]?.["name"]).toBe(payload);
    expect(found[0]?.["workspace_id"]).toBe(f.wsA.id);

    // Cleanup so the next probe starts clean.
    await withCronAdminContext(f.sql, async (tx) => {
      await tx.unsafe(`DELETE FROM agent WHERE id=$1`, [id]);
    });
  });
});
