// apps/web/tests/isolation/db-scan.spec.ts
//
// Cross-tenant deep scan. For every tenant-scoped table:
//
//   1. Seed at least one row into each workspace (so wsB has data to leak).
//   2. With app_user + app.workspace_id=wsA, count rows visible to wsA.
//   3. With app_user + app.workspace_id=wsB, count rows visible to wsB.
//   4. With cron_admin (BYPASSRLS), count the total.
//
// Invariant: visible_to(wsA) ∩ visible_to(wsB) = ∅ AND every visible id
// must show up in the BYPASSRLS total.
//
// Phase C runs this BEFORE the FORCE migration to establish a baseline
// (RLS policies already filter by workspace_id, so the suite should pass
// even unforced) — then again AFTER FORCE to confirm the enforcement
// pathway works under the stricter regime.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Integration tests need the real DB module — un-mock before any dynamic imports.
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

// Tables protected by Pattern A (direct workspace_id column). Names match
// the live Postgres schema (drizzle var names differ in some cases).
//
// Excluded: `message` is Pattern B (RLS keyed via conversation join, no
// workspace_id column). `idempotency_key` has a composite PK that doesn't
// fit the "insert one row" canary model — covered separately if needed.
const TENANT_TABLES = [
  "agent",
  "team",
  "channel",
  "employee",
  "conversation",
  "flow",
  "flow_run",
  "workspace_integration",
  "api_key",
  "knowledge_base",
  "knowledge_doc",
  "knowledge_chunk",
  "agent_memory",
  "audit_log",
  "feature_flag",
  "gdpr_export_job",
  "conversation_label",
  "notification_pref",
  "ai_provider",
  "outbound_webhook",
  "security_event",
];

let f: IsolationFixture;

// Seed one canary row per tenant per table. Using superuser (bypasses RLS)
// to seed unconditionally. seqOffset disambiguates unique-keyed rows when
// the same table gets seeded multiple times.
async function seedRow(
  table: string,
  wsId: string,
  ownerUserId: string,
  seqOffset: number
): Promise<string> {
  const id = createId();
  const sql = f.sql;
  switch (table) {
    case "agent":
      await sql.unsafe(
        `INSERT INTO agent (id, workspace_id, name, role, system_prompt, status)
         VALUES ($1, $2, $3, 'iso', 'sp', 'active')`,
        [id, wsId, `iso-agent-${seqOffset}`]
      );
      return id;
    case "team":
      await sql.unsafe(`INSERT INTO team (id, workspace_id, name) VALUES ($1, $2, $3)`, [
        id,
        wsId,
        `iso-team-${seqOffset}`,
      ]);
      return id;
    case "channel":
      // type is channel_type enum: "web" is a safe value.
      await sql.unsafe(
        `INSERT INTO channel (id, workspace_id, name, type, status)
         VALUES ($1, $2, $3, 'web', 'active')`,
        [id, wsId, `iso-channel-${seqOffset}`]
      );
      return id;
    case "employee":
      await sql.unsafe(
        `INSERT INTO employee (id, workspace_id, name, email)
         VALUES ($1, $2, $3, $4)`,
        [id, wsId, `iso-emp-${seqOffset}`, `iso-${id}@example.invalid`]
      );
      return id;
    case "conversation":
      await sql.unsafe(
        `INSERT INTO conversation (id, workspace_id, status) VALUES ($1, $2, 'open')`,
        [id, wsId]
      );
      return id;
    case "flow":
      await sql.unsafe(
        `INSERT INTO flow (id, workspace_id, name, status, trigger, nodes, edges)
         VALUES ($1, $2, $3, 'draft', 'manual', '[]'::jsonb, '[]'::jsonb)`,
        [id, wsId, `iso-flow-${seqOffset}`]
      );
      return id;
    case "flow_run": {
      const flowId = createId();
      await sql.unsafe(
        `INSERT INTO flow (id, workspace_id, name, status, trigger, nodes, edges)
         VALUES ($1, $2, $3, 'draft', 'manual', '[]'::jsonb, '[]'::jsonb)`,
        [flowId, wsId, `iso-flow-for-run-${seqOffset}`]
      );
      await sql.unsafe(
        `INSERT INTO flow_run (id, workspace_id, flow_id, status, input)
         VALUES ($1, $2, $3, 'succeeded', '{}'::jsonb)`,
        [id, wsId, flowId]
      );
      return id;
    }
    case "workspace_integration":
      await sql.unsafe(
        `INSERT INTO workspace_integration (id, workspace_id, type, name, config_encrypted)
         VALUES ($1, $2, $3, $4, 'enc')`,
        [id, wsId, `iso-int-${seqOffset}`, `iso-int-${seqOffset}-name`]
      );
      return id;
    case "api_key":
      await sql.unsafe(
        `INSERT INTO api_key (id, workspace_id, name, hashed_key, prefix)
         VALUES ($1, $2, $3, $4, 'iso_')`,
        [id, wsId, `iso-key-${seqOffset}`, `hash-${id}`]
      );
      return id;
    case "knowledge_base":
      await sql.unsafe(`INSERT INTO knowledge_base (id, workspace_id, name) VALUES ($1, $2, $3)`, [
        id,
        wsId,
        `iso-kb-${seqOffset}`,
      ]);
      return id;
    case "knowledge_doc": {
      const kbId = createId();
      await sql.unsafe(`INSERT INTO knowledge_base (id, workspace_id, name) VALUES ($1, $2, $3)`, [
        kbId,
        wsId,
        `iso-kb-for-doc-${seqOffset}`,
      ]);
      await sql.unsafe(
        `INSERT INTO knowledge_doc (id, workspace_id, kb_id, title, source, status)
         VALUES ($1, $2, $3, $4, 'text', 'ready')`,
        [id, wsId, kbId, `iso-doc-${seqOffset}`]
      );
      return id;
    }
    case "knowledge_chunk": {
      const kbId = createId();
      const docId = createId();
      await sql.unsafe(`INSERT INTO knowledge_base (id, workspace_id, name) VALUES ($1, $2, $3)`, [
        kbId,
        wsId,
        `iso-kb-for-chunk-${seqOffset}`,
      ]);
      await sql.unsafe(
        `INSERT INTO knowledge_doc (id, workspace_id, kb_id, title, source, status)
         VALUES ($1, $2, $3, $4, 'text', 'ready')`,
        [docId, wsId, kbId, `iso-doc-for-chunk-${seqOffset}`]
      );
      await sql.unsafe(
        `INSERT INTO knowledge_chunk (id, workspace_id, doc_id, kb_id, ordinal, text)
         VALUES ($1, $2, $3, $4, 0, 'iso content')`,
        [id, wsId, docId, kbId]
      );
      return id;
    }
    case "agent_memory": {
      const agentRows = await sql.unsafe(`SELECT id FROM agent WHERE workspace_id=$1 LIMIT 1`, [
        wsId,
      ]);
      const agentId = agentRows[0]?.["id"] as string;
      await sql.unsafe(
        `INSERT INTO agent_memory (id, workspace_id, agent_id, scope, data)
         VALUES ($1, $2, $3, 'global', $4::jsonb)`,
        [id, wsId, agentId, JSON.stringify({ iso: seqOffset })]
      );
      return id;
    }
    case "audit_log":
      // Hash chain expects monotonic seq per workspace; the integration
      // tests may have populated the chain earlier in the same process,
      // so derive next seq from MAX(seq) to avoid collisions.
      {
        // postgres-js can bind bigint values fine, but the `unsafe` signature
        // types parameters as string|number|boolean|null|Date|JSON, so we
        // cast `next` to text in the SELECT and let postgres parse it back.
        const max = await sql.unsafe(
          `SELECT (COALESCE(MAX(seq), 0) + 1)::text AS next FROM audit_log WHERE workspace_id=$1`,
          [wsId]
        );
        const nextSeq = (max[0]?.["next"] as string) ?? "1";
        await sql.unsafe(
          `INSERT INTO audit_log (id, workspace_id, seq, payload_hash, chain_hash, action, actor_kind, target_type, target_id)
           VALUES ($1, $2, $3::bigint, $4, $5, 'iso.seed', 'system', 'iso', $1)`,
          [id, wsId, nextSeq, "0".repeat(64), "1".repeat(64)]
        );
      }
      return id;
    case "feature_flag":
      await sql.unsafe(
        `INSERT INTO feature_flag (id, workspace_id, flag_key, enabled)
         VALUES ($1, $2, $3, true)`,
        [id, wsId, `iso-flag-${seqOffset}-${id.slice(-6)}`]
      );
      return id;
    case "gdpr_export_job":
      await sql.unsafe(
        `INSERT INTO gdpr_export_job (id, workspace_id, requested_by_user_id, state)
         VALUES ($1, $2, $3, 'pending')`,
        [id, wsId, ownerUserId]
      );
      return id;
    case "conversation_label":
      await sql.unsafe(
        `INSERT INTO conversation_label (id, workspace_id, name)
         VALUES ($1, $2, $3)`,
        [id, wsId, `iso-label-${seqOffset}-${id.slice(-6)}`]
      );
      return id;
    case "notification_pref":
      // unique(workspace_id, user_id, key) — null out user_id so reseeding
      // doesn't conflict with the test workspace owner row.
      await sql.unsafe(
        `INSERT INTO notification_pref (id, workspace_id, user_id, key, enabled)
         VALUES ($1, $2, NULL, $3, true)`,
        [id, wsId, `iso-pref-${seqOffset}-${id.slice(-6)}`]
      );
      return id;
    case "ai_provider":
      // unique(workspace_id, provider) — pad provider with seqOffset.
      await sql.unsafe(
        `INSERT INTO ai_provider (id, workspace_id, provider, api_key)
         VALUES ($1, $2, $3, 'enc-iso')`,
        [id, wsId, `iso-prov-${seqOffset}-${id.slice(-6)}`]
      );
      return id;
    case "outbound_webhook":
      await sql.unsafe(
        `INSERT INTO outbound_webhook (id, workspace_id, url, secret, events)
         VALUES ($1, $2, $3, 'iso-secret', '["conv.created"]'::jsonb)`,
        [id, wsId, `https://example.invalid/${id}`]
      );
      return id;
    case "security_event":
      await sql.unsafe(
        `INSERT INTO security_event (id, workspace_id, event_type, severity, detail)
         VALUES ($1, $2, 'iso.test', 'info', '{}'::jsonb)`,
        [id, wsId]
      );
      return id;
    default:
      throw new Error(`No seed strategy for table: ${table}`);
  }
}

beforeAll(async () => {
  f = await setupIsolation();
  let i = 0;
  for (const table of TENANT_TABLES) {
    i += 1;
    await seedRow(table, f.wsA.id, f.wsA.ownerId, i);
    await seedRow(table, f.wsB.id, f.wsB.ownerId, i);
  }
}, 60_000);

afterAll(async () => {
  await teardownIsolation(f);
  await teardownTestWorkspaces();
});

describe("Cross-tenant DB scan", () => {
  it.each(TENANT_TABLES)("%s: app_user wsA sees zero rows belonging to wsB", async (table) => {
    const visibleToA = await withAppUserContext(f.sql, f.wsA.id, async (tx) => {
      return tx.unsafe(`SELECT id FROM ${table}`);
    });
    const visibleToB = await withAppUserContext(f.sql, f.wsB.id, async (tx) => {
      return tx.unsafe(`SELECT id FROM ${table}`);
    });
    const total = await withCronAdminContext(f.sql, async (tx) => {
      return tx.unsafe(`SELECT id FROM ${table}`);
    });

    const idsA = new Set(visibleToA.map((r) => r["id"] as string));
    const idsB = new Set(visibleToB.map((r) => r["id"] as string));
    const totalIds = new Set(total.map((r) => r["id"] as string));

    // Each tenant must see at least the canary row we seeded for it.
    expect(idsA.size).toBeGreaterThan(0);
    expect(idsB.size).toBeGreaterThan(0);

    // Visible sets must be disjoint.
    const overlap = [...idsA].filter((id) => idsB.has(id));
    expect(overlap).toEqual([]);

    // Containment: every visible id must exist in the BYPASSRLS total.
    for (const id of idsA) expect(totalIds.has(id)).toBe(true);
    for (const id of idsB) expect(totalIds.has(id)).toBe(true);
  });
});
