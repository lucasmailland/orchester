import { createId } from "@paralleldrive/cuid2";
import { createDbClient } from "./client";
import * as schema from "./schema";
import { eq } from "drizzle-orm";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const db = createDbClient(url);

  const [ws] = await db.select().from(schema.workspaces).limit(1);
  if (!ws) {
    console.log("No workspace yet. Sign in once to create one, then re-run.");
    process.exit(0);
  }
  const wsId = ws.id;
  console.log("Seeding into workspace:", ws.name);

  // Skip if already seeded
  const existingFlows = await db.select().from(schema.flows).where(eq(schema.flows.workspaceId, wsId));
  if (existingFlows.length > 0) {
    console.log(`Workspace already has ${existingFlows.length} flows; skipping seed.`);
    process.exit(0);
  }

  // teams
  const ventasId = createId();
  const soporteId = createId();
  await db.insert(schema.teams).values([
    { id: ventasId, workspaceId: wsId, name: "Ventas", description: "Equipo comercial" },
    { id: soporteId, workspaceId: wsId, name: "Soporte", description: "Atención al cliente" },
  ]);

  // agents
  const leadAgentId = createId();
  const closerAgentId = createId();
  const supportAgentId = createId();
  await db.insert(schema.agents).values([
    {
      id: leadAgentId,
      workspaceId: wsId,
      teamId: ventasId,
      name: "Lead Qualifier",
      role: "Califica leads B2B",
      systemPrompt:
        "You are a B2B sales lead qualifier. Use BANT to evaluate leads and return a JSON score with budget, authority, need, timeline.",
      model: "claude-sonnet-4-6",
      status: "active",
      temperature: "0.30",
    },
    {
      id: closerAgentId,
      workspaceId: wsId,
      teamId: ventasId,
      name: "Closer Bot",
      role: "Cierra oportunidades",
      systemPrompt:
        "You are a closing assistant. Help reps move qualified leads to closed-won by suggesting next-step proposals.",
      model: "claude-sonnet-4-6",
      status: "active",
      temperature: "0.50",
    },
    {
      id: supportAgentId,
      workspaceId: wsId,
      teamId: soporteId,
      name: "Support Tier 1",
      role: "Atención de primer nivel",
      systemPrompt:
        "You are a Tier 1 support agent. Answer common questions politely and escalate complex issues to humans.",
      model: "claude-haiku-4-5",
      status: "active",
      temperature: "0.30",
    },
  ]);

  // sample pipeline flow
  const triggerNodeId = createId();
  const qualifyNodeId = createId();
  const condNodeId = createId();
  const closerNodeId = createId();
  await db.insert(schema.flows).values({
    id: createId(),
    workspaceId: wsId,
    name: "Pipeline de leads",
    description: "Califica un lead y lo envía al Closer si supera 50 puntos",
    status: "active",
    enabled: true,
    nodes: [
      {
        id: triggerNodeId,
        type: "trigger",
        label: "Inicio",
        config: { trigger: "manual" },
        position: { x: 60, y: 200 },
      },
      {
        id: qualifyNodeId,
        type: "agent",
        label: "Calificar lead",
        config: {
          agentId: leadAgentId,
          message: "Evaluá este lead: {{lead}}",
          outputVar: "score",
        },
        position: { x: 320, y: 200 },
      },
      {
        id: condNodeId,
        type: "condition",
        label: "¿Score > 50?",
        config: { condition: { left: "{{score}}", op: ">", right: "50" } },
        position: { x: 600, y: 200 },
      },
      {
        id: closerNodeId,
        type: "agent",
        label: "Closer Bot",
        config: {
          agentId: closerAgentId,
          message: "Cerrá este lead calificado: {{lead}}",
          outputVar: "closingResponse",
        },
        position: { x: 880, y: 140 },
      },
    ],
    edges: [
      { id: createId(), source: triggerNodeId, target: qualifyNodeId },
      { id: createId(), source: qualifyNodeId, target: condNodeId },
      { id: createId(), source: condNodeId, target: closerNodeId, sourceHandle: "true" },
    ],
  });

  // assign agents to first employee (if exists)
  const emps = await db.select().from(schema.employees).where(eq(schema.employees.workspaceId, wsId));
  if (emps[0]) {
    await db
      .update(schema.employees)
      .set({ assignedAgentIds: [leadAgentId, closerAgentId] })
      .where(eq(schema.employees.id, emps[0].id));
    console.log(`Assigned 2 agents to employee ${emps[0].name}`);
  }

  console.log("✓ Seed v2 complete:");
  console.log("  - 2 teams (Ventas, Soporte)");
  console.log("  - 3 agents (Lead Qualifier, Closer Bot, Support Tier 1)");
  console.log("  - 1 flow (Pipeline de leads)");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
