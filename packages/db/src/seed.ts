import { createDbClient } from "./client";
import { users, accounts, workspaces, workspaceMembers } from "./schema";
import { createId } from "@paralleldrive/cuid2";

const DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgresql://orchester:orchester@localhost:5432/orchester";

const db = createDbClient(DATABASE_URL);

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function seed() {
  console.log("🌱 Seeding Orchester demo data...");

  const workspaceId = createId();
  await db
    .insert(workspaces)
    .values({ id: workspaceId, name: "Acme Inc.", slug: "acme-inc" })
    .onConflictDoNothing();

  console.log(`✓ Workspace: Acme Inc. (${workspaceId})`);

  const userId = createId();
  await db
    .insert(users)
    .values({
      id: userId,
      name: "Demo Admin",
      email: "demo@fichap.com",
      emailVerified: true,
      onboardingCompleted: true,
      preferredLocale: "en",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing();

  console.log(`✓ User: demo@fichap.com`);

  const accountId = createId();
  await db
    .insert(accounts)
    .values({
      id: accountId,
      accountId: userId,
      providerId: "credential",
      userId,
      password: await hashPassword("demo1234"),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing();

  console.log(`✓ Password account (demo1234)`);

  await db
    .insert(workspaceMembers)
    .values({
      id: createId(),
      workspaceId,
      userId,
      role: "owner",
      createdAt: new Date(),
    })
    .onConflictDoNothing();

  console.log(`✓ Workspace member: owner`);

  console.log("\n🎉 Demo data seeded successfully!");
  console.log("  Login: demo@fichap.com / demo1234");
  console.log(`  Workspace: Acme Inc. (ID: ${workspaceId})`);

  process.exit(0);
}

seed().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
