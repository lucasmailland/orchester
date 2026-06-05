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
import { schema } from "@orchester/db";
import { redactSecrets } from "../redact";
import type { ExporterDb } from "./workspace";

export async function exportAgents(workspaceId: string, db: ExporterDb) {
  // Run sequentially (not Promise.all): when `db` is a transaction
  // handle threaded down from `withCrossTenantAdmin`, parallel awaits
  // would issue overlapping queries on the SAME pooled connection,
  // which postgres-js rejects ("another statement is in progress").
  // Sequential awaits cost ~3x the wallclock time per exporter but
  // keep the txn valid; throughput here isn't latency-critical (the
  // export worker is async — the UI polls progress).
  const teams = await db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.workspaceId, workspaceId));
  const agents = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.workspaceId, workspaceId));
  const channels = await db
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

  // Phase F.3 (2026-05-26): defensive scrub over the JSONB columns on
  // agents (`config`, `tools`, `variables`, `branding`) — they can land
  // arbitrary operator-supplied content (e.g. a variable holding an
  // API key for use in a prompt template). Column-selection alone is
  // not enough since the columns themselves are unstructured.
  const scrubbedAgents = agents.map((a) => redactSecrets(a) as typeof a);

  return {
    teams,
    agents: scrubbedAgents,
    channels: sanitisedChannels,
  };
}
