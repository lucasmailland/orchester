import { createDbClient } from "./client";
import {
  users,
  accounts,
  orgs,
  workspaces,
  workspaceMembers,
  teams,
  agents,
  channels,
  employees,
  conversations,
  messages,
} from "./schema";
import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://orchester:orchester@localhost:5432/orchester";

const db = createDbClient(DATABASE_URL);

async function hashPassword(password: string): Promise<string> {
  const { hashPassword: baHash } = await import("@better-auth/utils/password");
  return baHash(password);
}

const AREAS = ["HR", "IT", "Finance", "Sales", "Marketing", "Operations", "Legal", "Engineering"];
const EMPLOYEE_NAMES = [
  "Ana García",
  "Carlos López",
  "María Rodríguez",
  "José Martínez",
  "Laura Fernández",
  "Miguel Sánchez",
  "Carmen Díaz",
  "Antonio González",
  "Isabel Ruiz",
  "Pedro Jiménez",
  "Sofía Torres",
  "David Moreno",
  "Elena Álvarez",
  "Juan Romero",
  "Claudia Navarro",
  "Roberto Molina",
  "Patricia Domínguez",
  "Fernando Castro",
  "Valentina Ortega",
  "Diego Vargas",
];

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Simulate realistic token counts: user msgs = shorter, assistant msgs = longer
function convTokens(
  msgCount: number
): Array<{ role: "user" | "assistant" | "system"; tokens: number }> {
  const msgs: Array<{ role: "user" | "assistant" | "system"; tokens: number }> = [
    { role: "system", tokens: rand(80, 200) },
  ];
  for (let i = 0; i < msgCount - 1; i++) {
    if (i % 2 === 0) {
      msgs.push({ role: "user", tokens: rand(15, 120) });
    } else {
      msgs.push({ role: "assistant", tokens: rand(80, 450) });
    }
  }
  return msgs;
}

async function seed() {
  console.log("🌱 Seeding Orchester rich demo data...");

  // Resolve existing workspace
  const existingWs = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.slug, "acme-inc"))
    .limit(1);
  const workspaceId = existingWs[0]?.id ?? createId();
  // v2 — every workspace has an org. Default: personal org keyed
  // 1:1 with the workspace id, matching the migration 0049 backfill.
  await db
    .insert(orgs)
    .values({
      id: `org_${workspaceId}`,
      name: "Acme Inc.",
    })
    .onConflictDoNothing();
  await db
    .insert(workspaces)
    .values({
      id: workspaceId,
      name: "Acme Inc.",
      slug: "acme-inc",
      orgId: `org_${workspaceId}`,
    })
    .onConflictDoNothing();
  console.log("✓ Workspace: Acme Inc.");

  // Clean up existing workspace data to avoid duplicates on re-seed
  if (existingWs[0]) {
    console.log("  Cleaning up existing workspace data...");
    await db.delete(conversations).where(eq(conversations.workspaceId, workspaceId));
    await db.delete(agents).where(eq(agents.workspaceId, workspaceId));
    await db.delete(channels).where(eq(channels.workspaceId, workspaceId));
    await db.delete(teams).where(eq(teams.workspaceId, workspaceId));
    await db.delete(employees).where(eq(employees.workspaceId, workspaceId));
    console.log("  ✓ Cleaned");
  }

  // Upsert user: resolve existing ID to avoid FK mismatch on re-seed
  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, "demo@fichap.com"))
    .limit(1);
  const userId = existingUser[0]?.id ?? createId();

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

  // Always replace account to ensure password hash is correct
  await db.delete(accounts).where(eq(accounts.userId, userId));
  await db.insert(accounts).values({
    id: createId(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: await hashPassword("demo1234"),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

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
  console.log("✓ User: demo@fichap.com / demo1234");

  const teamHrId = createId();
  const teamItId = createId();
  const teamOnboardingId = createId();

  await db
    .insert(teams)
    .values([
      {
        id: teamHrId,
        workspaceId,
        name: "HR Benefits",
        description: "Handles vacations, leaves, payroll questions and HR policies.",
        avatarColor: "#3B3BFF",
      },
      {
        id: teamItId,
        workspaceId,
        name: "IT Support",
        description: "Internal helpdesk, password resets, hardware requests.",
        avatarColor: "#7C3AED",
      },
      {
        id: teamOnboardingId,
        workspaceId,
        name: "Employee Onboarding",
        description: "Guides new hires through their first weeks at Acme.",
        avatarColor: "#22C55E",
      },
    ])
    .onConflictDoNothing();
  console.log("✓ 3 teams created");

  const agentIds = {
    hrMain: createId(),
    hrEscalation: createId(),
    itMain: createId(),
    itAssets: createId(),
    onboardingWelcome: createId(),
    onboardingDocs: createId(),
  };

  const agentModels: Record<string, string> = {
    [agentIds.hrMain]: "claude-sonnet-4-6",
    [agentIds.hrEscalation]: "claude-opus-4-7",
    [agentIds.itMain]: "claude-sonnet-4-6",
    [agentIds.itAssets]: "claude-haiku-4-5-20251001",
    [agentIds.onboardingWelcome]: "claude-sonnet-4-6",
    [agentIds.onboardingDocs]: "claude-haiku-4-5-20251001",
  };

  await db
    .insert(agents)
    .values([
      {
        id: agentIds.hrMain,
        workspaceId,
        teamId: teamHrId,
        name: "Sofia HR",
        role: "HR Generalist",
        systemPrompt:
          "You are Sofia, a friendly HR assistant for Acme Inc. Help employees with vacation requests, leave policies, payroll questions, and HR procedures. Always be empathetic and professional.",
        model: agentModels[agentIds.hrMain]!,
        status: "active",
      },
      {
        id: agentIds.hrEscalation,
        workspaceId,
        teamId: teamHrId,
        name: "Elena HR Pro",
        role: "Senior HR Specialist",
        systemPrompt:
          "You are Elena, a senior HR specialist. Handle complex HR cases escalated from Sofia. You have authority to approve leave requests up to 5 days.",
        model: agentModels[agentIds.hrEscalation]!,
        status: "active",
      },
      {
        id: agentIds.itMain,
        workspaceId,
        teamId: teamItId,
        name: "Max IT",
        role: "IT Support Analyst",
        systemPrompt:
          "You are Max, an IT support agent for Acme Inc. Help employees with password resets, software installation, VPN access, and technical troubleshooting.",
        model: agentModels[agentIds.itMain]!,
        status: "active",
      },
      {
        id: agentIds.itAssets,
        workspaceId,
        teamId: teamItId,
        name: "Asset Bot",
        role: "Asset Manager",
        systemPrompt:
          "You handle hardware asset requests at Acme Inc. Process laptop requests, peripherals, monitors, and phone equipment. Verify budget approval before processing orders over $500.",
        model: agentModels[agentIds.itAssets]!,
        status: "active",
      },
      {
        id: agentIds.onboardingWelcome,
        workspaceId,
        teamId: teamOnboardingId,
        name: "Alex Welcome",
        role: "Onboarding Coordinator",
        systemPrompt:
          "You are Alex, the first point of contact for new Acme employees. Walk them through day 1 logistics: office access, IT setup, benefits enrollment, and team introductions.",
        model: agentModels[agentIds.onboardingWelcome]!,
        status: "active",
      },
      {
        id: agentIds.onboardingDocs,
        workspaceId,
        teamId: teamOnboardingId,
        name: "Doc Helper",
        role: "Documentation Bot",
        systemPrompt:
          "You help new Acme employees complete their onboarding paperwork: NDA, direct deposit, benefits forms, and equipment agreements.",
        model: agentModels[agentIds.onboardingDocs]!,
        status: "draft",
      },
    ])
    .onConflictDoNothing();
  console.log("✓ 6 agents created");

  const channelWebId = createId();
  const channelWaId = createId();
  const channelTgId = createId();

  await db
    .insert(channels)
    .values([
      {
        id: channelWebId,
        workspaceId,
        teamId: teamHrId,
        name: "HR Web Widget",
        type: "web",
        status: "active",
      },
      {
        id: channelWaId,
        workspaceId,
        teamId: teamItId,
        name: "IT WhatsApp",
        type: "whatsapp",
        status: "active",
      },
      {
        id: channelTgId,
        workspaceId,
        teamId: teamOnboardingId,
        name: "Onboarding Telegram",
        type: "telegram",
        status: "inactive",
      },
    ])
    .onConflictDoNothing();
  console.log("✓ 3 channels created");

  const employeeIds: string[] = [];
  const empValues = EMPLOYEE_NAMES.map((name, i) => {
    const id = createId();
    employeeIds.push(id);
    return {
      id,
      workspaceId,
      name,
      email:
        name
          .toLowerCase()
          .replace(/ /g, ".")
          .replace(/[áéíóú]/g, (c) => ({ á: "a", é: "e", í: "i", ó: "o", ú: "u" })[c] ?? c) +
        "@acme.com",
      area: AREAS[i % AREAS.length],
      phone: `+54 9 11 ${rand(1000, 9999)}-${rand(1000, 9999)}`,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });
  await db.insert(employees).values(empValues).onConflictDoNothing();
  console.log(`✓ ${empValues.length} employees created`);

  // Weight agents by realistic usage frequency
  const agentPool = [
    ...Array(4).fill(agentIds.hrMain), // most used
    ...Array(3).fill(agentIds.itMain),
    ...Array(2).fill(agentIds.onboardingWelcome),
    agentIds.hrEscalation,
    agentIds.itAssets,
    agentIds.onboardingDocs,
  ];
  const allChannelIds = [channelWebId, channelWebId, channelWaId, channelTgId]; // web more common
  const statuses: Array<"open" | "closed" | "escalated"> = [
    "closed",
    "closed",
    "closed",
    "open",
    "escalated",
  ];

  let totalConvs = 0;
  let totalMessages = 0;

  for (let daysAgo = 60; daysAgo >= 0; daysAgo--) {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    // More traffic on weekdays, less on weekends
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const baseCount = isWeekend ? 1 : 5;
    const dailyCount = baseCount + rand(0, isWeekend ? 2 : 5);

    for (let j = 0; j < dailyCount; j++) {
      const convId = createId();
      const empId = employeeIds[rand(0, employeeIds.length - 1)]!;
      const agentId = agentPool[rand(0, agentPool.length - 1)]!;
      const channelId = allChannelIds[rand(0, allChannelIds.length - 1)]!;
      const status = statuses[rand(0, statuses.length - 1)]!;
      const msgCount = rand(3, 14);
      const durationSec = 30 + msgCount * rand(15, 45);

      const startedAt = new Date(date);
      startedAt.setHours(rand(7, 18));
      startedAt.setMinutes(rand(0, 59));

      await db
        .insert(conversations)
        .values({
          id: convId,
          workspaceId,
          channelId,
          employeeId: empId,
          agentId,
          status,
          messageCount: msgCount,
          durationSeconds: durationSec,
          startedAt,
          endedAt: status !== "open" ? new Date(startedAt.getTime() + durationSec * 1000) : null,
          createdAt: startedAt,
        })
        .onConflictDoNothing();

      // Insert messages with token data
      const msgTurns = convTokens(msgCount);
      let msgTime = new Date(startedAt);
      for (const turn of msgTurns) {
        await db
          .insert(messages)
          .values({
            id: createId(),
            conversationId: convId,
            role: turn.role,
            content: `[Message content — ${turn.role} — ${turn.tokens} tokens]`,
            tokensUsed: turn.tokens,
            createdAt: new Date(msgTime),
          })
          .onConflictDoNothing();
        msgTime = new Date(msgTime.getTime() + rand(10, 90) * 1000);
        totalMessages++;
      }

      totalConvs++;
    }
  }

  console.log(`✓ ${totalConvs} conversations + ${totalMessages} messages over 60 days`);
  console.log("\n🎉 Rich demo data seeded successfully!");
  console.log("  Login: demo@fichap.com / demo1234");
  process.exit(0);
}

seed().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
