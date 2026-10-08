import { z } from "zod";

/**
 * Flow labelling. A `pipeline` is a top-level flow; an `action` is a reusable
 * building block that pipelines call. Actions obey a stricter contract (see
 * `validateStoredFlow`) so they stay cheap, deterministic and safe to reuse.
 *
 * Client-safe on purpose: the editor, the flows list, the REST routes and the
 * MCP tools all read it.
 */
export const FLOW_KINDS = ["pipeline", "action"] as const;
export type FlowKind = (typeof FLOW_KINDS)[number];

export const flowKindSchema = z.enum(FLOW_KINDS);

export const MAX_EXTERNAL_CALLERS = 10;
export const EXTERNAL_CALLER_NAME_MAX = 80;
export const EXTERNAL_CALLER_NOTE_MAX = 200;

/**
 * Callers that live OUTSIDE the product (a script calling `run_flow` by id).
 * The in-product reference check cannot see them, so they are declared here
 * and block deletion until the list is cleared.
 */
export const externalCallerSchema = z
  .object({
    name: z.string().trim().min(1).max(EXTERNAL_CALLER_NAME_MAX),
    note: z.string().max(EXTERNAL_CALLER_NOTE_MAX).optional(),
  })
  .strict();

export const externalCallersSchema = z.array(externalCallerSchema).max(MAX_EXTERNAL_CALLERS);

export type ExternalCaller = z.infer<typeof externalCallerSchema>;

export function formatExternalCallers(
  callers: ReadonlyArray<{ name: string; note?: string | undefined }>
): string {
  return callers.map((c) => c.name).join(", ");
}

/**
 * Reads the stored list. Stored JSON is untrusted, but a malformed entry must
 * still count as a caller: it is used to BLOCK deletion, so it fails closed.
 * Anything that is not an array reads as empty.
 */
export function readExternalCallers(value: unknown): ExternalCaller[] {
  if (!Array.isArray(value)) return [];
  return value.map((item): ExternalCaller => {
    const parsed = externalCallerSchema.safeParse(item);
    if (parsed.success) return parsed.data;
    const name = (item as { name?: unknown } | null)?.name;
    return { name: typeof name === "string" && name ? name : "(unnamed)" };
  });
}
