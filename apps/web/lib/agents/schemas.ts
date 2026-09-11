import { z } from "zod";

/**
 * Body accepted by PATCH /api/agents/[id].
 *
 * Lives outside the route file because Next only allows HTTP handlers and
 * route config to be exported from route.ts, and the schema needs tests.
 */
export const updateAgentSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  role: z.string().trim().min(1, "Role is required"),
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
  status: z.enum(["active", "inactive", "draft"]).optional(),
  teamId: z.string().nullable().optional(),
  temperature: z.union([z.number(), z.string()]).optional(),
  maxTokens: z.number().optional(),
  kind: z.enum(["conversational", "flow"]).optional(),
  flowId: z.string().nullable().optional(),
  tools: z.array(z.string()).optional(),
  variables: z.record(z.string(), z.string()).optional(),
  greeting: z.string().nullable().optional(),
  fallback: z.string().nullable().optional(),
  starters: z.array(z.string()).optional(),
  avatarUrl: z.string().nullable().optional(),
  color: z.string().optional(),
  maxTurns: z.number().optional(),
  responseFormat: z.enum(["text", "json", "markdown"]).optional(),
  // outputSchema es un JSON Schema arbitrario definido por el usuario.
  // Nullable because null is what GET returns for an agent without one, and
  // what the editor sends back on every save. Rejecting it made saving from
  // the agent editor fail with a 400 for almost every agent.
  outputSchema: z.record(z.string(), z.unknown()).nullable().optional(),
});
