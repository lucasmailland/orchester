import { createDbClient } from "./client";
import {
  users, accounts, workspaces, workspaceMembers,
  teams, agents, channels, employees, conversations,
} from "./schema";
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

const AREAS = ["HR", "IT", "Finance", "Sales", "Marketing", "Operations", "Legal", "Engineering"];
const EMPLOYEE_NAMES = [
  "Ana García", "Carlos López", "María Rodríguez", "José Martínez", "Laura Fernández",
  "Miguel Sánchez", "Carmen Díaz", "Antonio González", "Isabel Ruiz", "Pedro Jiménez",
  "Sofía Torres", "David Moreno", "Elena Álvarez", "Juan Romero", "Claudia Navarro",
  "Roberto Molina", "Patricia Domínguez", "Fernando Castro", "Valentina Ortega", "Diego Vargas",
];

async function seed() {
  console.log("🌱 Seeding Orchester rich demo data...");

  const workspaceId = createId();
  await db.insert(workspaces).values({
    id: workspaceId, name: "Acme Inc.", slug: "acme-inc",
  }).onConflictDoNothing();
  console.log("✓ Workspace: Acme Inc.");

  const userId = createId();
  await db.insert(users).values({
    id: userId, name: "Demo Admin", email: "demo@fichap.com",
    emailVerified: true, onboardingCompleted: true,
    preferredLocale: "en", createdAt: new Date(), updatedAt: new Date(),
  }).onConflictDoNothing();

  await db.insert(accounts).values({
    id: createId(), accountId: userId, providerId: "credential",
    userId, password: await hashPassword("demo1234"),
    createdAt: new Date(), updatedAt: new Date(),
  }).onConflictDoNothing();

  await db.insert(workspaceMembers).values({
    id: createId(), workspaceId, userId, role: "owner", createdAt: new Date(),
  }).onConflictDoNothing();
  console.log("✓ User: demo@fichap.com / demo1234");

  const teamHrId = createId();
  const teamItId = createId();
  const teamOnboardingId = createId();

  await db.insert(teams).values([
    { id: teamHrId, workspaceId, name: "HR Benefits", description: "Handles vacations, leaves, payroll questions and HR policies.", avatarColor: "#3B3BFF" },
    { id: teamItId, workspaceId, name: "IT Support", description: "Internal helpdesk, password resets, hardware requests.", avatarColor: "#7C3AED" },
    { id: teamOnboardingId, workspaceId, name: "Employee Onboarding", description: "Guides new hires through their first weeks at Acme.", avatarColor: "#22C55E" },
  ]).onConflictDoNothing();
  console.log("✓ 3 teams created");

  const agentIds = {
    hrMain: createId(), hrEscalation: createId(),
    itMain: createId(), itAssets: createId(),
    onboardingWelcome: createId(), onboardingDocs: createId(),
  };

  await db.insert(agents).values([
    { id: agentIds.hrMain, workspaceId, teamId: teamHrId, name: "Sofia HR", role: "HR Generalist", systemPrompt: "You are Sofia, a friendly HR assistant for Acme Inc. Help employees with vacation requests, leave policies, payroll questions, and HR procedures.", model: "claude-sonnet-4-6", status: "active" },
    { id: agentIds.hrEscalation, workspaceId, teamId: teamHrId, name: "Elena HR Pro", role: "Senior HR Specialist", systemPrompt: "You are Elena, a senior HR specialist. Handle complex HR cases escalated from Sofia.", model: "claude-opus-4-7", status: "active" },
    { id: agentIds.itMain, workspaceId, teamId: teamItId, name: "Max IT", role: "IT Support Analyst", systemPrompt: "You are Max, an IT support agent for Acme Inc. Help employees with password resets, software installation, and technical issues.", model: "claude-sonnet-4-6", status: "active" },
    { id: agentIds.itAssets, workspaceId, teamId: teamItId, name: "Asset Bot", role: "Asset Manager", systemPrompt: "You handle hardware asset requests at Acme Inc. Process laptop requests, peripherals, and monitor requests.", model: "claude-haiku-4-5", status: "active" },
    { id: agentIds.onboardingWelcome, workspaceId, teamId: teamOnboardingId, name: "Alex Welcome", role: "Onboarding Coordinator", systemPrompt: "You are Alex, the first point of contact for new Acme employees. Walk them through day 1 logistics.", model: "claude-sonnet-4-6", status: "active" },
    { id: agentIds.onboardingDocs, workspaceId, teamId: teamOnboardingId, name: "Doc Helper", role: "Documentation Bot", systemPrompt: "You help new Acme employees complete their onboarding paperwork.", model: "claude-haiku-4-5", status: "draft" },
  ]).onConflictDoNothing();
  console.log("✓ 6 agents created");

  const channelWebId = createId();
  const channelWaId = createId();
  const channelTgId = createId();

  await db.insert(channels).values([
    { id: channelWebId, workspaceId, teamId: teamHrId, name: "HR Web Widget", type: "web", status: "active" },
    { id: channelWaId, workspaceId, teamId: teamItId, name: "IT WhatsApp", type: "whatsapp", status: "active" },
    { id: channelTgId, workspaceId, teamId: teamOnboardingId, name: "Onboarding Telegram", type: "telegram", status: "inactive" },
  ]).onConflictDoNothing();
  console.log("✓ 3 channels created");

  const employeeIds: string[] = [];
  const empValues = EMPLOYEE_NAMES.map((name, i) => {
    const id = createId();
    employeeIds.push(id);
    return {
      id, workspaceId, name,
      email: name.toLowerCase().replace(/ /g, ".").replace(/[áéíóú]/g, (c) =>
        ({ á: "a", é: "e", í: "i", ó: "o", ú: "u" }[c] ?? c)
      ) + "@acme.com",
      area: AREAS[i % AREAS.length],
      phone: `+54 9 11 ${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`,
      active: true,
      createdAt: new Date(), updatedAt: new Date(),
    };
  });
  await db.insert(employees).values(empValues).onConflictDoNothing();
  console.log(`✓ ${empValues.length} employees created`);

  const allAgentIds = Object.values(agentIds);
  const allChannelIds = [channelWebId, channelWaId, channelTgId];
  const statuses: Array<"open" | "closed" | "escalated"> = ["closed", "closed", "closed", "open", "escalated"];
  let totalConvs = 0;

  for (let daysAgo = 30; daysAgo >= 0; daysAgo--) {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const dailyCount = 3 + Math.floor(Math.random() * 6);

    for (let j = 0; j < dailyCount; j++) {
      const convId = createId();
      const empId = employeeIds[Math.floor(Math.random() * employeeIds.length)];
      const agentId = allAgentIds[Math.floor(Math.random() * allAgentIds.length)];
      const channelId = allChannelIds[Math.floor(Math.random() * allChannelIds.length)];
      const status = statuses[Math.floor(Math.random() * statuses.length)] ?? "closed";
      const durationSec = 60 + Math.floor(Math.random() * 480);
      const msgCount = 4 + Math.floor(Math.random() * 12);
      const startedAt = new Date(date);
      startedAt.setHours(8 + Math.floor(Math.random() * 10));
      startedAt.setMinutes(Math.floor(Math.random() * 60));

      await db.insert(conversations).values({
        id: convId, workspaceId, channelId, employeeId: empId, agentId,
        status, messageCount: msgCount, durationSeconds: durationSec,
        startedAt,
        endedAt: status !== "open" ? new Date(startedAt.getTime() + durationSec * 1000) : null,
        createdAt: startedAt,
      }).onConflictDoNothing();
      totalConvs++;
    }
  }
  console.log(`✓ ${totalConvs} conversations over 30 days`);

  console.log("\n🎉 Rich demo data seeded successfully!");
  console.log("  Login: demo@fichap.com / demo1234");
  process.exit(0);
}

seed().catch((e) => { console.error("Seed failed:", e); process.exit(1); });
