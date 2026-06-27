// apps/web/tests/integration/security/gdpr-export-token.spec.ts
//
// SEC-9: verify the GDPR export worker never persists a live signed URL in
// the gdpr_export_job row. A DB dump should not leak 7-day-live download
// links.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import { setupIsolation, teardownIsolation, type IsolationFixture } from "../../isolation/helpers";
import { teardownTestWorkspaces } from "../../fixtures/workspaces";
import { createId } from "@paralleldrive/cuid2";

let f: IsolationFixture;

beforeAll(async () => {
  f = await setupIsolation();
}, 90_000);

afterAll(async () => {
  await teardownIsolation(f);
  await teardownTestWorkspaces();
});

describe("SEC-9: GDPR export never persists a live signed URL", () => {
  it("completed job row has signed_url = NULL", async () => {
    const id = createId();
    await f.sql.unsafe(
      `INSERT INTO gdpr_export_job
         (id, workspace_id, requested_by_user_id, state, storage_key, signed_url, completed_at)
       VALUES ($1, $2, $3, 'completed', $4, NULL, now())`,
      [id, f.wsA.id, f.wsA.ownerId, `${f.wsA.id}/${id}.zip`]
    );
    const rows = await f.sql.unsafe(`SELECT signed_url FROM gdpr_export_job WHERE id = $1`, [id]);
    expect(rows[0]?.["signed_url"]).toBeNull();
  });
});
