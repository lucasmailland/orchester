// apps/web/tests/isolation/mnemo-tenant.spec.ts
//
// Mnemosyne-specific cross-tenant isolation. The base `db-scan.spec.ts`
// covers the 21 host Pattern A tables; this spec extends the matrix
// across the cognitive primitives:
//
//   • mnemo_fact         (0017)
//   • mnemo_extraction_job (0017)
//   • mnemo_decision     (0018)
//   • mnemo_episode      (0034)
//   • mnemo_entity       (0039)
//
// Each is Pattern A (direct `workspace_id` column, four policies gated
// on `current_setting('app.workspace_id')`) and reached at runtime via
// `withMnemoTx(workspaceId, …)` which downgrades the tx to `app_user`.
//
// Additionally, this spec covers the per-actor RESTRICTIVE policy
// added in migration 0040: when `app.enforce_actor_isolation='true'`,
// the SELECT on `mnemo_fact` filters out rows whose `actor_id` is set
// to a value other than `app.actor_id` (NULL-actor rows are always
// visible — they represent workspace-shared knowledge).
//
// The policy is layered ON TOP of the workspace policy via
// RESTRICTIVE, so both must hold. We verify the four cell of the
// 2×2 matrix:
//
//                   actor_id=ME    actor_id=other   actor_id=NULL
//   GUC=true         ✓ visible      ✗ filtered       ✓ visible
//   GUC unset        ✓ visible      ✓ visible        ✓ visible
//
// Why all four cells matter:
//   • GUC=true / actor=ME    — happy path for per-actor recall
//   • GUC=true / actor=other — the rejection that protects the data subject
//   • GUC=true / actor=NULL  — workspace-shared facts must remain visible
//   • GUC unset              — legacy/cross-actor reads (admin, inspector)
//     must NOT be affected — back-compat requirement.
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

beforeAll(async () => {
  f = await setupIsolation();
}, 60_000);

afterAll(async () => {
  await teardownIsolation(f);
  await teardownTestWorkspaces();
});

/**
 * Seed one canary row per workspace for each mnemo_* table. Uses the
 * superuser sql client (bypasses RLS) so seeding succeeds regardless
 * of GUC state.
 *
 * Returns `{ wsA: <id>, wsB: <id> }` for downstream assertions.
 */
async function seedBoth(
  table: "mnemo_fact" | "mnemo_extraction_job" | "mnemo_decision" | "mnemo_episode" | "mnemo_entity"
): Promise<{ wsA: string; wsB: string }> {
  const wsA = await seedOne(table, f.wsA.id);
  const wsB = await seedOne(table, f.wsB.id);
  return { wsA, wsB };
}

async function seedOne(
  table: string,
  wsId: string,
  opts?: { actorId?: string | null }
): Promise<string> {
  const id = createId();
  const sql = f.sql;
  switch (table) {
    case "mnemo_fact":
      await sql.unsafe(
        `INSERT INTO mnemo_fact
           (id, workspace_id, scope, kind, subject, statement, actor_id)
         VALUES ($1, $2, 'global', 'preference', $3, 'iso statement', $4)`,
        [
          id,
          wsId,
          `iso-mnemo-fact-${id.slice(-6)}`,
          opts?.actorId === undefined ? null : opts.actorId,
        ]
      );
      return id;
    case "mnemo_extraction_job": {
      // Needs a conversation FK in the same workspace. Synthesise one
      // under cron_admin so RLS doesn't bite.
      const convId = createId();
      await sql.unsafe(
        `INSERT INTO conversation (id, workspace_id, status) VALUES ($1, $2, 'open')`,
        [convId, wsId]
      );
      await sql.unsafe(
        `INSERT INTO mnemo_extraction_job (id, workspace_id, conversation_id, message_count)
         VALUES ($1, $2, $3, 0)`,
        [id, wsId, convId]
      );
      return id;
    }
    case "mnemo_decision":
      await sql.unsafe(
        `INSERT INTO mnemo_decision
           (id, workspace_id, kind, title, body, normalized_hash)
         VALUES ($1, $2, 'policy', $3, 'iso body', $4)`,
        [id, wsId, `iso-decision-${id.slice(-6)}`, `hash-${id}`]
      );
      return id;
    case "mnemo_episode":
      await sql.unsafe(
        `INSERT INTO mnemo_episode
           (id, workspace_id, title, narrative, occurred_at)
         VALUES ($1, $2, $3, 'iso narrative', now())`,
        [id, wsId, `iso-episode-${id.slice(-6)}`]
      );
      return id;
    case "mnemo_entity":
      await sql.unsafe(
        `INSERT INTO mnemo_entity (id, workspace_id, name, kind)
         VALUES ($1, $2, $3, 'person')`,
        [id, wsId, `iso-entity-${id.slice(-6)}`]
      );
      return id;
    default:
      throw new Error(`No mnemo seed strategy for ${table}`);
  }
}

const MNEMO_TABLES = [
  "mnemo_fact",
  "mnemo_extraction_job",
  "mnemo_decision",
  "mnemo_episode",
  "mnemo_entity",
] as const;

describe("Mnemosyne cross-tenant SELECT isolation", () => {
  it.each(MNEMO_TABLES)("%s: workspace A sees only A's rows, never B's", async (table) => {
    const seeded = await seedBoth(table);

    const visibleToA = await withAppUserContext(f.sql, f.wsA.id, async (tx) => {
      return tx.unsafe(`SELECT id FROM ${table}`);
    });
    const visibleToB = await withAppUserContext(f.sql, f.wsB.id, async (tx) => {
      return tx.unsafe(`SELECT id FROM ${table}`);
    });

    const idsA = new Set(visibleToA.map((r) => r["id"] as string));
    const idsB = new Set(visibleToB.map((r) => r["id"] as string));

    // wsA sees its own row; wsB does not.
    expect(idsA.has(seeded.wsA)).toBe(true);
    expect(idsA.has(seeded.wsB)).toBe(false);
    // Symmetry: wsB sees its own row; wsA does not.
    expect(idsB.has(seeded.wsB)).toBe(true);
    expect(idsB.has(seeded.wsA)).toBe(false);
  });
});

describe("Mnemosyne cross-tenant WRITE isolation", () => {
  it.each(MNEMO_TABLES)("%s: INSERT with foreign workspace_id is rejected", async (table) => {
    const injectId = createId();
    // Each table has different required cols. Build the INSERT inline
    // per table — we can't reuse `seedOne` because we need it under
    // wsA's app_user context targeting wsB's workspace_id.
    const insert = async (tx: { unsafe: typeof f.sql.unsafe }) => {
      switch (table) {
        case "mnemo_fact":
          return tx.unsafe(
            `INSERT INTO mnemo_fact
               (id, workspace_id, scope, kind, subject, statement)
             VALUES ($1, $2, 'global', 'preference', $3, 'inj statement')`,
            [injectId, f.wsB.id, `inj-fact-${injectId.slice(-6)}`]
          );
        case "mnemo_extraction_job": {
          // For the INSERT-rejection test we don't actually need a
          // valid conversation_id — RLS short-circuits before the FK
          // is checked. Pass a deterministic dummy.
          return tx.unsafe(
            `INSERT INTO mnemo_extraction_job
               (id, workspace_id, conversation_id, message_count)
             VALUES ($1, $2, $3, 0)`,
            [injectId, f.wsB.id, "nonexistent-conv-id"]
          );
        }
        case "mnemo_decision":
          return tx.unsafe(
            `INSERT INTO mnemo_decision
               (id, workspace_id, kind, title, body, normalized_hash)
             VALUES ($1, $2, 'policy', $3, 'inj body', $4)`,
            [injectId, f.wsB.id, `inj-dec-${injectId.slice(-6)}`, `hash-${injectId}`]
          );
        case "mnemo_episode":
          return tx.unsafe(
            `INSERT INTO mnemo_episode
               (id, workspace_id, title, narrative, occurred_at)
             VALUES ($1, $2, $3, 'inj narrative', now())`,
            [injectId, f.wsB.id, `inj-ep-${injectId.slice(-6)}`]
          );
        case "mnemo_entity":
          return tx.unsafe(
            `INSERT INTO mnemo_entity (id, workspace_id, name, kind)
             VALUES ($1, $2, $3, 'person')`,
            [injectId, f.wsB.id, `inj-ent-${injectId.slice(-6)}`]
          );
        default:
          throw new Error(`No insert strategy for ${table}`);
      }
    };

    // The INSERT must fail with "row-level security policy" because
    // app.workspace_id (wsA) ≠ the row's workspace_id (wsB) in WITH CHECK.
    await expect(withAppUserContext(f.sql, f.wsA.id, async (tx) => insert(tx))).rejects.toThrow(
      /row-level security|new row violates/i
    );

    // Belt-and-braces: confirm under cron_admin the inject row never landed.
    const stillThere = await withCronAdminContext(f.sql, async (tx) => {
      const rows = await tx.unsafe(`SELECT id FROM ${table} WHERE id=$1`, [injectId]);
      return rows.length;
    });
    expect(stillThere).toBe(0);
  });
});

describe("mnemo_fact actor_id RESTRICTIVE policy (migration 0040)", () => {
  // Seed three facts in wsA with different actor_id values. We use a
  // unique workspace-scoped subject so the dedup unique index doesn't
  // collide with rows seeded by other tests in the same process.
  const ACTOR_ME = "actor:user-alice";
  const ACTOR_OTHER = "actor:user-bob";
  let factIdMe: string;
  let factIdOther: string;
  let factIdNull: string;

  beforeAll(async () => {
    factIdMe = await seedOne("mnemo_fact", f.wsA.id, { actorId: ACTOR_ME });
    factIdOther = await seedOne("mnemo_fact", f.wsA.id, { actorId: ACTOR_OTHER });
    factIdNull = await seedOne("mnemo_fact", f.wsA.id, { actorId: null });
  });

  it("GUC unset → all three workspace facts visible (legacy back-compat)", async () => {
    const visible = await withAppUserContext(f.sql, f.wsA.id, async (tx) => {
      const rows = await tx.unsafe(`SELECT id FROM mnemo_fact WHERE id = ANY($1::text[])`, [
        [factIdMe, factIdOther, factIdNull],
      ]);
      return new Set(rows.map((r) => r["id"] as string));
    });
    expect(visible.has(factIdMe)).toBe(true);
    expect(visible.has(factIdOther)).toBe(true);
    expect(visible.has(factIdNull)).toBe(true);
  });

  it("GUC=true + actor=ME → ME's fact + NULL fact visible; OTHER's filtered", async () => {
    const visible = await f.sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE app_user`);
      await tx.unsafe(`SELECT set_config('app.workspace_id', $1, true)`, [f.wsA.id]);
      await tx.unsafe(`SELECT set_config('app.enforce_actor_isolation', 'true', true)`);
      await tx.unsafe(`SELECT set_config('app.actor_id', $1, true)`, [ACTOR_ME]);
      const rows = await tx.unsafe(`SELECT id FROM mnemo_fact WHERE id = ANY($1::text[])`, [
        [factIdMe, factIdOther, factIdNull],
      ]);
      return new Set(rows.map((r) => r["id"] as string));
    });
    expect(visible.has(factIdMe)).toBe(true);
    expect(visible.has(factIdNull)).toBe(true);
    expect(visible.has(factIdOther)).toBe(false);
  });

  it("GUC=true + actor=OTHER → OTHER's fact + NULL fact visible; ME's filtered", async () => {
    const visible = await f.sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE app_user`);
      await tx.unsafe(`SELECT set_config('app.workspace_id', $1, true)`, [f.wsA.id]);
      await tx.unsafe(`SELECT set_config('app.enforce_actor_isolation', 'true', true)`);
      await tx.unsafe(`SELECT set_config('app.actor_id', $1, true)`, [ACTOR_OTHER]);
      const rows = await tx.unsafe(`SELECT id FROM mnemo_fact WHERE id = ANY($1::text[])`, [
        [factIdMe, factIdOther, factIdNull],
      ]);
      return new Set(rows.map((r) => r["id"] as string));
    });
    expect(visible.has(factIdOther)).toBe(true);
    expect(visible.has(factIdNull)).toBe(true);
    expect(visible.has(factIdMe)).toBe(false);
  });

  it("GUC='false' (not the literal 'true') → policy collapses to no-op", async () => {
    // The migration comment specifies: the gate fires ONLY when the
    // GUC is literally 'true'. Any other value (including 'false',
    // 'TRUE', '1', etc.) leaves the policy a no-op. This protects
    // against accidental partial activation.
    const visible = await f.sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE app_user`);
      await tx.unsafe(`SELECT set_config('app.workspace_id', $1, true)`, [f.wsA.id]);
      await tx.unsafe(`SELECT set_config('app.enforce_actor_isolation', 'false', true)`);
      await tx.unsafe(`SELECT set_config('app.actor_id', $1, true)`, [ACTOR_ME]);
      const rows = await tx.unsafe(`SELECT id FROM mnemo_fact WHERE id = ANY($1::text[])`, [
        [factIdMe, factIdOther, factIdNull],
      ]);
      return new Set(rows.map((r) => r["id"] as string));
    });
    // All three visible — actor gate is OFF.
    expect(visible.has(factIdMe)).toBe(true);
    expect(visible.has(factIdOther)).toBe(true);
    expect(visible.has(factIdNull)).toBe(true);
  });
});
