/**
 * Which Odoo project tasks an AGENT may write to.
 *
 * An agent's tool inputs are steered by text it read — a card, a thread, a
 * customer's report — so "post a note on task 12345" can come from anywhere.
 * A flow step was written by a person and reviewed as config. The Odoo
 * integration can therefore name the projects agents may write tasks in
 * (`agentWriteProjects`); flow steps stay unrestricted.
 *
 * Scope: project tasks only (notes, tags, stage, and `execute` writes on
 * `project.task`). Helpdesk tickets are not covered — agents that file tickets
 * keep working when the setting is turned on.
 *
 * A call that does not say who it is counts as an agent: a new call site has
 * to declare itself a flow step to skip the check, never the other way round.
 */
import type { ActionContext } from "./registry";

export const AGENT_WRITE_PROJECTS_KEY = "agentWriteProjects";

/** The setting as a set of project ids; null when it is empty (no limit). */
export function parseAgentWriteProjects(raw: string | undefined): ReadonlySet<number> | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const ids = text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((part) => (/^\d{1,12}$/.test(part) ? Number(part) : NaN));
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error(
      'Odoo: "Projects agents may write to" must be project ids separated by commas, e.g. 12, 31.'
    );
  }
  return new Set(ids);
}

type TaskRow = { id: number; project_id: [number, string] | false };
export type ReadTaskProjects = (ids: number[]) => Promise<TaskRow[]>;

function limited(config: Record<string, string>, ctx: ActionContext | undefined) {
  if (ctx?.caller === "flow") return null;
  return parseAgentWriteProjects(config[AGENT_WRITE_PROJECTS_KEY]);
}

/** How every refusal starts; the tool call log files a call with it as `refused`. */
export const WRITE_SCOPE_REFUSAL_PREFIX = "Agents may only write to tasks of project";

function refusal(allowed: ReadonlySet<number>, why: string): Error {
  return new Error(`${WRITE_SCOPE_REFUSAL_PREFIX} ${[...allowed].join(", ")}; ${why}.`);
}

/**
 * Throws unless every task exists and sits in a project agents may write to.
 * The project is read from Odoo, never taken from the caller.
 */
export async function assertAgentMayWriteTasks(
  config: Record<string, string>,
  ctx: ActionContext | undefined,
  taskIds: unknown[],
  readTaskProjects: ReadTaskProjects
): Promise<void> {
  const allowed = limited(config, ctx);
  if (!allowed) return;
  const ids = taskIds.map(Number);
  if (ids.length === 0 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error("An agent write needs explicit, valid task ids.");
  }
  const unique = [...new Set(ids)];
  const rows = await readTaskProjects(unique);
  const projectOf = new Map(rows.map((r) => [r.id, r.project_id ? r.project_id[0] : null]));
  for (const id of unique) {
    if (!projectOf.has(id)) throw new Error(`Task ${id} not found.`);
    const project = projectOf.get(id);
    if (project == null || !allowed.has(project)) {
      throw refusal(
        allowed,
        `task ${id} is in ${project == null ? "no project" : `project ${project}`}`
      );
    }
  }
}

/**
 * Throws unless a `project_id` the caller wants to write — on a new task, or
 * to move an existing one — is a project agents may write to.
 */
export function assertAgentMayTargetProject(
  config: Record<string, string>,
  ctx: ActionContext | undefined,
  values: unknown,
  { required }: { required: boolean }
): void {
  const allowed = limited(config, ctx);
  if (!allowed) return;
  const vals = values && typeof values === "object" ? (values as Record<string, unknown>) : {};
  if (!("project_id" in vals)) {
    if (required) throw refusal(allowed, "the new task names no project");
    return;
  }
  const project = Number(vals.project_id);
  if (!allowed.has(project))
    throw refusal(allowed, `project ${String(vals.project_id)} is not one`);
}

/** `message_post` options an agent may pass under a project limit (no partner_ids: that notifies people). */
const AGENT_MESSAGE_POST_KWARGS = new Set(["body", "message_type", "subtype_xmlid"]);

/**
 * Under a project limit, an agent's `execute` on project.task may only set
 * plain fields. A relational command (`child_ids: [[1, otherId, {...}]]`,
 * `[[2, id]]`) writes other records the task check never saw, and extra
 * kwargs (`partner_ids` on message_post, a `context`) widen the call. Both
 * are refused; a flow step keeps the full call.
 */
export function assertAgentExecuteIsPlain(
  config: Record<string, string>,
  ctx: ActionContext | undefined,
  method: string,
  values: unknown,
  kwargs: Record<string, unknown>
): void {
  const allowed = limited(config, ctx);
  if (!allowed) return;
  if (values && typeof values === "object") {
    for (const [field, value] of Object.entries(values as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        throw refusal(allowed, `${field} is a relational command, which agents may not send`);
      }
    }
  }
  const extra = Object.keys(kwargs).filter(
    (k) => !(method === "message_post" && AGENT_MESSAGE_POST_KWARGS.has(k))
  );
  if (extra.length) throw refusal(allowed, `${extra.join(", ")} cannot be passed by agents`);
}
