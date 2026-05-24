// apps/web/lib/gdpr/exporters/agents.ts
//
// Per-table dump of every agent + the agent's home team in a workspace.
// Strips no fields by default — system prompts and tool lists are user
// content the requester is entitled to. Channels live alongside agents
// but carry encrypted credentials, so they get their own redaction
// pass below.
//
// We export channels here (not a dedicated channels exporter) because
// they're a small joinable companion table and grouping them keeps the
// archive flatter for the recipient.
import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@orchester/db";
import type { ExporterDb } from "./workspace";

export async function exportAgents(workspaceId: string, db?: ExporterDb) {
  const client = db ?? getDb();

  // Run sequentially (not Promise.all): when `client` is a transaction
  // handle threaded down from `withCrossTenantAdmin`, parallel awaits
  // would issue overlapping queries on the SAME pooled connection,
  // which postgres-js rejects ("another statement is in progress").
  // Sequential awaits cost ~3x the wallclock time per exporter but
  // keep the txn valid; throughput here isn't latency-critical (the
  // export worker is async — the UI polls progress).
  const teams = await client
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.workspaceId, workspaceId));
  const agents = await client
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.workspaceId, workspaceId));
  const channels = await client
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.workspaceId, workspaceId));

  // Strip encrypted credentials + the webhook secret — both are
  // operational secrets, not data the requester needs in their export.
  // (Re-issuing them is cheap; leaking them in a downloadable archive
  // is not.)
  const sanitisedChannels = channels.map((c) => {
    const { credentialsEncrypted: _credentials, secret: _secret, ...rest } = c;
    return rest;
  });

  return {
    teams,
    agents,
    channels: sanitisedChannels,
  };
}
