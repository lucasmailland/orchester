// apps/web/tests/fixtures/workspaces.ts
//
// Seeds two deterministic workspaces (with owner + agents) used by
// integration suites to exercise tenant-scoped behaviour. faker is
// seeded so the generated names/emails are stable across runs.
import { setupTestDb, teardownTestDb } from "./db";
import { faker } from "@faker-js/faker";
import { createId } from "@paralleldrive/cuid2";
import { schema } from "@orchester/db";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

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

async function createWorkspace(db: PostgresJsDatabase, slug: string): Promise<WsFixture> {
  const wsId = createId();
  const ownerId = createId();
  const email = faker.internet.email();

  // All inserts run in a single transaction so the
  // `workspace_owner_must_be_member` DEFERRABLE constraint
  // trigger (migration 0014) sees the membership row at
  // COMMIT. Otherwise each `db.insert()` commits on its own
  // and the workspace insert fails before the member exists.
  const agentIds: string[] = [];
  await db.transaction(async (tx) => {
    await tx.insert(schema.users).values({
      id: ownerId,
      email,
      name: faker.person.fullName(),
      emailVerified: true,
    });

    await tx.insert(schema.workspaces).values({
      id: wsId,
      slug,
      name: faker.company.name(),
      timezone: "UTC",
      status: "active",
      ownerUserId: ownerId,
    });

    await tx.insert(schema.workspaceMembers).values({
      id: createId(),
      workspaceId: wsId,
      userId: ownerId,
      role: "owner",
    });

    for (let i = 0; i < 3; i++) {
      const aid = createId();
      agentIds.push(aid);
      await tx.insert(schema.agents).values({
        id: aid,
        workspaceId: wsId,
        name: `Agent ${i + 1}`,
        role: "test",
        systemPrompt: "you are a test agent",
        status: "active",
      });
    }
  });

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

export interface InsertAdHocWorkspaceArgs {
  /** Used for the workspace and audit log seq counting. Provided so tests
   *  can reference the wsId in subsequent inserts/queries. */
  wsId: string;
  ownerId: string;
  slug: string;
  name?: string;
  email?: string;
  status?: "active" | "suspended" | "deleted";
}

/**
 * Insert a workspace + its owner user + the owner membership row in a single
 * transaction. The `workspace_owner_must_be_member` constraint trigger
 * (migration 0014) is DEFERRABLE INITIALLY DEFERRED, so all three rows must
 * arrive inside the same transaction for the check (which fires at COMMIT) to
 * pass.
 *
 * Use this in integration tests that need an extra ad-hoc workspace outside
 * the suite-level fixtures (e.g. legacy-bootstrap audit chain tests, lifecycle
 * negative paths).
 *
 * The `db` param is typed loosely (`unknown`-cast at the boundary) because
 * pnpm resolves drizzle-orm into two peer copies — one through
 * `@orchester/db`, one through `apps/web` direct dep — and TS treats them as
 * nominally distinct. At runtime both are the same package; the cast is the
 * same narrow safe pattern used by `tests/fixtures/db.ts` for the migrator.
 */
export async function insertAdHocWorkspace(
  db: unknown,
  args: InsertAdHocWorkspaceArgs
): Promise<void> {
  const safeDb = db as PostgresJsDatabase;
  await safeDb.transaction(async (tx) => {
    await tx.insert(schema.users).values({
      id: args.ownerId,
      email: args.email ?? `${args.ownerId}@test.local`,
      name: args.name ?? args.slug,
      emailVerified: true,
    });
    await tx.insert(schema.workspaces).values({
      id: args.wsId,
      slug: args.slug,
      name: args.name ?? args.slug,
      timezone: "UTC",
      status: args.status ?? "active",
      ownerUserId: args.ownerId,
    });
    await tx.insert(schema.workspaceMembers).values({
      id: createId(),
      workspaceId: args.wsId,
      userId: args.ownerId,
      role: "owner",
    });
  });
}
