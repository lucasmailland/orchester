import "server-only";
import { sendEmail } from "@/lib/email";
import { recipientsFor } from "./resolve";
import { safeLogError } from "@/lib/safe-log";

async function fanOut(
  workspaceId: string,
  key: string,
  subject: string,
  text: string
): Promise<void> {
  try {
    const recipients = await recipientsFor(workspaceId, key);
    await Promise.allSettled(recipients.map((r) => sendEmail({ to: r.email, subject, text })));
  } catch (e) {
    safeLogError(`[notifications:${key}] fan-out failed:`, e);
  }
}

export async function notifyEscalation(
  workspaceId: string,
  data: { conversationId: string }
): Promise<void> {
  await fanOut(
    workspaceId,
    "conv_escalated",
    "Una conversación se escaló a un humano",
    `La conversación ${data.conversationId} fue escalada y espera atención.`
  );
}

export async function notifyAgentDown(
  workspaceId: string,
  data: { agentId: string; agentName: string }
): Promise<void> {
  await fanOut(
    workspaceId,
    "agent_down",
    `El agente ${data.agentName} quedó fuera de línea`,
    `El agente ${data.agentName} (${data.agentId}) ya no está activo.`
  );
}

export async function notifyNewMember(workspaceId: string, data: { email: string }): Promise<void> {
  await fanOut(
    workspaceId,
    "new_member",
    "Nuevo miembro en tu workspace",
    `${data.email} se unió a tu workspace.`
  );
}

export async function notifyWeeklyReport(
  workspaceId: string,
  data: { tokens: number; conversations: number }
): Promise<void> {
  await fanOut(
    workspaceId,
    "weekly_report",
    "Tu resumen semanal de Orchester",
    `Esta semana: ${data.conversations} conversaciones · ${data.tokens} tokens.`
  );
}
