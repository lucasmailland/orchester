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

  const [teams, agents, channels] = await Promise.all([
    client.select().from(schema.teams).where(eq(schema.teams.workspaceId, workspaceId)),
    client.select().from(schema.agents).where(eq(schema.agents.workspaceId, workspaceId)),
    client.select().from(schema.channels).where(eq(schema.channels.workspaceId, workspaceId)),
  ]);

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
