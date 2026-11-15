import "server-only";
import { createId } from "@paralleldrive/cuid2";
import { schema } from "@orchester/db";
import { and, eq } from "drizzle-orm";
import { withWorkspaceTx } from "@/lib/tenant/context";

const DEMO_MARKER = "Demo · Asistente de Ventas";

/**
 * SET-5: lightweight, per-workspace demo seed for fresh users. Far smaller
 * than packages/db/src/seed-demo.ts (CLI-only) — a few agents + one flow +
 * a couple conversations so the product doesn't look empty after signup.
 * Idempotent: bails if the marker agent already exists in the workspace.
 */
export async function seedLightweightDemo(workspaceId: string): Promise<{ seeded: boolean }> {
  return withWorkspaceTx(workspaceId, async (tx) => {
    const existing = await tx
      .select({ id: schema.agents.id })
      .from(schema.agents)
      .where(and(eq(schema.agents.workspaceId, workspaceId), eq(schema.agents.name, DEMO_MARKER)))
      .limit(1);
    if (existing[0]) return { seeded: false };

    const agentSpecs = [
      { name: DEMO_MARKER, role: "Ventas", prompt: "Sos un asistente de ventas amable y conciso." },
      {
        name: "Demo · Soporte",
        role: "Soporte",
        prompt: "Resolvés dudas de clientes con claridad.",
      },
      {
        name: "Demo · Triage",
        role: "Triage",
        prompt: "Clasificás y derivás consultas entrantes.",
      },
    ];
    const agentIds: string[] = [];
    for (const a of agentSpecs) {
      const id = createId();
      agentIds.push(id);
      await tx.insert(schema.agents).values({
        id,
        workspaceId,
        name: a.name,
        role: a.role,
        systemPrompt: a.prompt,
        status: "active",
      });
    }

    // One simple flow chaining triage → ventas.
    await tx.insert(schema.flows).values({
      id: createId(),
      workspaceId,
      name: "Demo · Pipeline de leads",
      status: "active",
      trigger: "manual",
      enabled: true,
      nodes: [
        { id: "n1", type: "trigger", label: "Inicio", config: {}, position: { x: 0, y: 0 } },
        {
          id: "n2",
          type: "agent",
          label: "Triage",
          config: { agentId: agentIds[2] },
          position: { x: 0, y: 120 },
        },
        {
          id: "n3",
          type: "agent",
          label: "Ventas",
          config: { agentId: agentIds[0] },
          position: { x: 0, y: 240 },
        },
        { id: "n4", type: "end", label: "Fin", config: {}, position: { x: 0, y: 360 } },
      ],
      edges: [
        { id: "e1", source: "n1", target: "n2" },
        { id: "e2", source: "n2", target: "n3" },
        { id: "e3", source: "n3", target: "n4" },
      ],
    });

    // A couple of sample conversations so the dashboard isn't empty.
    for (let i = 0; i < 2; i++) {
      const convId = createId();
      await tx.insert(schema.conversations).values({
        id: convId,
        workspaceId,
        agentId: agentIds[0]!,
        status: i === 0 ? "closed" : "open",
        externalId: `demo-${createId()}`,
        customerName: i === 0 ? "Ada Lovelace" : "Alan Turing",
        messageCount: 2,
        totalTokens: 800 + i * 200,
        totalCostUsd: String(0.5 + i * 0.2),
        summary: i === 0 ? "Consulta sobre planes" : "Pregunta de soporte",
      });
      await tx.insert(schema.messages).values([
        {
          id: createId(),
          conversationId: convId,
          role: "user",
          content: "Hola, tengo una consulta.",
        },
        {
          id: createId(),
          conversationId: convId,
          role: "assistant",
          content: "¡Hola! ¿En qué te ayudo?",
          tokensUsed: 400,
          costUsd: "0.25",
        },
      ]);
    }

    return { seeded: true };
  });
}
