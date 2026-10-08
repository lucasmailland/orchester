import { z } from "zod";
import type { ValidationIssue } from "./validate";

/**
 * Named groups of flow steps ("Fetch monitoring data", "Write the ticket note").
 *
 * Presentation only. Groups live in their own column next to the graph
 * (`flow.groups`, `flow_version.groups`), so the engine, the validators, dry
 * runs, `describe_flow` and the node-nature counts never see them: the steps
 * and edges they run are exactly the ones they ran before. A group only says
 * which steps the editor draws as one block, and what that block is called.
 *
 * Client-safe on purpose (zod only): the editor, the REST routes, the service
 * and the MCP tools all read it.
 */

export const MAX_GROUPS = 50;
export const GROUP_NAME_MAX = 60;
export const GROUP_DESCRIPTION_MAX = 160;
export const GROUP_MEMBERS_MAX = 200;
const GROUP_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Icons a group may use: the names of the step icon map
 * (`components/flows/nodes/icon-map.ts`), kept here as plain strings so the
 * server can validate them without importing the icon library. A test holds
 * the two lists in step.
 */
export const FLOW_GROUP_ICONS = [
  "Play",
  "MessageSquare",
  "Clock",
  "Webhook",
  "Bot",
  "BookOpen",
  "GitBranch",
  "Split",
  "Repeat",
  "Rows3",
  "LifeBuoy",
  "Code2",
  "Plug",
  "Globe",
  "Wand2",
  "Table2",
  "Timer",
  "Bell",
  "UserCheck",
  "Workflow",
  "StickyNote",
  "Image",
  "Binary",
  "Video",
  "Volume2",
  "Mic",
  "ListOrdered",
  "Drama",
  "Music",
  "ScanText",
] as const;
export type FlowGroupIcon = (typeof FLOW_GROUP_ICONS)[number];

export interface FlowGroup {
  id: string;
  name: string;
  /** One line, typed by whoever builds the group. */
  description?: string | undefined;
  icon?: FlowGroupIcon | undefined;
  /** The steps drawn as this block. At least two; a step belongs to one group at most. */
  nodeIds: string[];
}

export const flowGroupSchema = z
  .object({
    id: z.string().regex(GROUP_ID, "group id: letters, digits, _ and - (max 64)"),
    name: z.string().trim().min(1, "group name required").max(GROUP_NAME_MAX),
    description: z
      .string()
      .trim()
      .max(GROUP_DESCRIPTION_MAX)
      .refine((s) => !/[\r\n]/.test(s), "group description must be one line")
      .optional(),
    icon: z.enum(FLOW_GROUP_ICONS).optional(),
    nodeIds: z
      .array(z.string().min(1).max(128))
      .min(2, "a group needs at least two steps")
      .max(GROUP_MEMBERS_MAX)
      .refine((ids) => new Set(ids).size === ids.length, "a step is listed twice in the group"),
  })
  .strict();

export const flowGroupsSchema = z.array(flowGroupSchema).max(MAX_GROUPS);

/** Fixed key order and no empty optionals, so two equal groups serialize the same. */
export function canonicalGroup(group: FlowGroup): FlowGroup {
  return {
    id: group.id,
    name: group.name,
    ...(group.description ? { description: group.description } : {}),
    ...(group.icon ? { icon: group.icon } : {}),
    nodeIds: [...group.nodeIds],
  };
}

export function canonicalGroups(groups: readonly FlowGroup[]): FlowGroup[] {
  return groups.map(canonicalGroup);
}

/**
 * Rules that need the flow's steps: every member exists, a step is in one
 * group at most (nested groups are not supported) and group ids are unique.
 * Shape rules (lengths, icon, at least two members) are the schema's.
 */
export function groupIssues(
  groups: readonly FlowGroup[],
  nodeIds: Iterable<string>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const known = new Set(nodeIds);
  const seenGroups = new Set<string>();
  const owner = new Map<string, string>();
  for (const group of groups) {
    if (seenGroups.has(group.id)) {
      issues.push({ level: "error", message: `Group id "${group.id}" is used twice.` });
    }
    seenGroups.add(group.id);
    for (const id of group.nodeIds) {
      if (!known.has(id)) {
        issues.push({
          level: "error",
          message: `Group "${group.name}" lists "${id}", which is not a step of this flow.`,
        });
        continue;
      }
      const other = owner.get(id);
      if (other !== undefined) {
        issues.push({
          level: "error",
          nodeId: id,
          message: `Step "${id}" is in groups "${other}" and "${group.name}"; a step can be in one group only (groups cannot be nested).`,
        });
        continue;
      }
      owner.set(id, group.name);
    }
  }
  return issues;
}

/**
 * Reads stored groups. Stored JSON is untrusted: malformed entries are
 * dropped, and when two groups claim a step the first one wins. Groups are
 * presentation, so dropping a bad one never changes what the flow runs.
 */
export function normalizeFlowGroups(raw: unknown): FlowGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: FlowGroup[] = [];
  const claimed = new Set<string>();
  const ids = new Set<string>();
  for (const item of raw.slice(0, MAX_GROUPS)) {
    const parsed = flowGroupSchema.safeParse(item);
    if (!parsed.success) continue;
    const group = parsed.data as FlowGroup;
    if (ids.has(group.id) || group.nodeIds.some((id) => claimed.has(id))) continue;
    ids.add(group.id);
    group.nodeIds.forEach((id) => claimed.add(id));
    out.push(canonicalGroup(group));
  }
  return out;
}

/**
 * Keeps groups in step with the flow after steps were removed: members that
 * are gone are dropped, and so is a group left with fewer than two steps (a
 * group of one step is just the step).
 */
export function pruneFlowGroups(
  groups: readonly FlowGroup[],
  nodeIds: Iterable<string>
): FlowGroup[] {
  const known = new Set(nodeIds);
  const out: FlowGroup[] = [];
  for (const group of groups) {
    const members = group.nodeIds.filter((id) => known.has(id));
    if (members.length < 2) continue;
    out.push(canonicalGroup({ ...group, nodeIds: members }));
  }
  return out;
}

/** Step id -> id of the group it belongs to. */
export function groupOfNode(groups: readonly FlowGroup[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of groups) for (const id of group.nodeIds) map.set(id, group.id);
  return map;
}
