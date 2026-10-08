import "server-only";
import { z } from "zod";
import type { McpToolDef } from "./server";
import { actorOf } from "./flow-tools";

const id = (value: unknown) => z.string().min(1).parse(value);
const teamProperties = {
  name: { type: "string" },
  description: { type: "string" },
  avatarColor: { type: "string" },
};
const confirm = {
  type: "string",
  description: "Nombre actual exacto del recurso para confirmar la eliminación.",
};

export const ADMIN_TOOLS: McpToolDef[] = [
  {
    name: "list_teams",
    title: "List teams",
    description:
      "Lista los equipos del workspace: id, nombre, descripción, color y cantidad de agentes.",
    domain: "teams",
    access: "read",
    inputSchema: { type: "object", properties: {} },
    async handler(_input, auth) {
      const { listTeams } = await import("@/lib/teams/service");
      return { teams: await listTeams(actorOf(auth)) };
    },
  },
  {
    name: "create_team",
    title: "Create a team",
    description:
      "Crea un equipo en el workspace con nombre obligatorio, descripción y color opcionales.",
    domain: "teams",
    access: "write",
    inputSchema: { type: "object", properties: teamProperties, required: ["name"] },
    async handler(input, auth) {
      const { createTeam, createTeamSchema } = await import("@/lib/teams/service");
      return createTeam(actorOf(auth), createTeamSchema.parse(input));
    },
  },
  {
    name: "update_team",
    title: "Update a team",
    description:
      "Actualiza parcialmente un equipo. Sólo cambian los campos enviados; requiere al menos un campo.",
    domain: "teams",
    access: "write",
    inputSchema: {
      type: "object",
      properties: { teamId: { type: "string" }, ...teamProperties },
      required: ["teamId"],
    },
    async handler(input, auth) {
      const { updateTeam, updateTeamSchema } = await import("@/lib/teams/service");
      return updateTeam(actorOf(auth), id(input.teamId), updateTeamSchema.parse(input));
    },
  },
  {
    name: "delete_team",
    title: "Delete a team",
    description:
      "Elimina un equipo vacío. Requiere teams:delete y confirm con el nombre exacto. Si tiene agentes o canales, devuelve sus nombres y rechaza la eliminación.",
    domain: "teams",
    access: "delete",
    inputSchema: {
      type: "object",
      properties: { teamId: { type: "string" }, confirm },
      required: ["teamId", "confirm"],
    },
    async handler(input, auth) {
      const { deleteTeam } = await import("@/lib/teams/service");
      return deleteTeam(actorOf(auth), id(input.teamId), input.confirm);
    },
  },
  {
    name: "get_agent",
    title: "Get an agent",
    description:
      "Devuelve la configuración completa de un agente: prompt, tools, equipo, estado, tipo, flujo y modelo.",
    domain: "agents",
    access: "read",
    inputSchema: {
      type: "object",
      properties: { agentId: { type: "string" } },
      required: ["agentId"],
    },
    async handler(input, auth) {
      const { getAgent } = await import("@/lib/agents/admin-service");
      return getAgent(actorOf(auth), id(input.agentId));
    },
  },
  {
    name: "update_agent",
    title: "Update an agent",
    description:
      "Actualiza parcialmente un agente. teamId null lo deja sin equipo. Rechaza tools que no estén en el catálogo; sólo cambian los campos enviados.",
    domain: "agents",
    access: "write",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string" },
        name: { type: "string" },
        role: { type: "string" },
        systemPrompt: { type: "string" },
        model: { type: "string" },
        status: { type: "string", enum: ["draft", "active", "inactive"] },
        teamId: { type: ["string", "null"] },
        tools: { type: "array", items: { type: "string" } },
        temperature: { type: ["number", "string"] },
        maxTokens: { type: "number" },
      },
      required: ["agentId"],
    },
    async handler(input, auth) {
      const { updateAgent } = await import("@/lib/agents/admin-service");
      return updateAgent(actorOf(auth), id(input.agentId), input);
    },
  },
  {
    name: "delete_agent",
    title: "Delete an agent",
    description:
      "Elimina un agente draft o inactive sin referencias de flujos, canales, empleados ni memorias. Requiere agents:delete y confirm con el nombre exacto. Elimina versiones y evaluaciones; desvincula conversaciones y conserva el historial de uso.",
    domain: "agents",
    access: "delete",
    inputSchema: {
      type: "object",
      properties: { agentId: { type: "string" }, confirm },
      required: ["agentId", "confirm"],
    },
    async handler(input, auth) {
      const { deleteAgent } = await import("@/lib/agents/admin-service");
      return deleteAgent(actorOf(auth), id(input.agentId), input.confirm);
    },
  },
];
