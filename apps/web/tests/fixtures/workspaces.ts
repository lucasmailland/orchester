// apps/web/tests/fixtures/workspaces.ts
//
// Seeds two deterministic workspaces (with owner + agents) used by
// integration suites to exercise tenant-scoped behaviour. faker is
// seeded so the generated names/emails are stable across runs.
import { setupTestDb, teardownTestDb } from "./db";
import { faker } from "@faker-js/faker";
import { createId } from "@paralleldrive/cuid2";
import { schema } from "@orchester/db";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export interface WsFixture {
  id: string;
  slug: string;
  name: string;
  ownerId: string;
  ownerEmail: string;
  agentCount: number;
  agentIds: string[];
}

export async function setupTestWorkspaces(): Promise<[WsFixture, WsFixture]> {
  faker.seed(42); // determinism
  const { db } = await setupTestDb();

  const wsA = await createWorkspace(db, "acme-hr");
  const wsB = await createWorkspace(db, "acme-marketing");

  return [wsA, wsB];
}

async function createWorkspace(db: NodePgDatabase, slug: string): Promise<WsFixture> {
  const wsId = createId();
  const ownerId = createId();
  const email = faker.internet.email();

  // Insert user
  await db.insert(schema.users).values({
    id: ownerId,
    email,
    name: faker.person.fullName(),
    emailVerified: true,
  });

  // Insert workspace
  await db.insert(schema.workspaces).values({
    id: wsId,
    slug,
    name: faker.company.name(),
    timezone: "UTC",
    status: "active",
    ownerUserId: ownerId,
  });

  // Insert membership
  await db.insert(schema.workspaceMembers).values({
    id: createId(),
    workspaceId: wsId,
    userId: ownerId,
    role: "owner",
  });

  // Seed some agents
  const agentIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const aid = createId();
    agentIds.push(aid);
    await db.insert(schema.agents).values({
      id: aid,
      workspaceId: wsId,
      name: `Agent ${i + 1}`,
      role: "test",
      systemPrompt: "you are a test agent",
      status: "active",
    });
  }

  return {
    id: wsId,
    slug,
    name: slug,
    ownerId,
    ownerEmail: email,
    agentCount: 3,
    agentIds,
  };
}

export async function teardownTestWorkspaces(): Promise<void> {
  await teardownTestDb();
}
