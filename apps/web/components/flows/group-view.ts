import type { Edge, Node } from "@xyflow/react";
import { groupOfNode, type FlowGroup } from "@/lib/flows/groups";
import { nodeNature } from "@/lib/flows/node-nature";

/**
 * What the canvas draws for a flow with step groups. Pure on purpose (no
 * xyflow runtime, no React), so the rules are tested on their own:
 *
 * - A collapsed group is ONE block in place of its steps. Edges that enter or
 *   leave the group are drawn to and from the block; edges between two steps
 *   of the same group are hidden while it is collapsed.
 * - An expanded group draws its steps as usual, with a frame behind them that
 *   carries the group's name and controls.
 *
 * Only the drawing changes. The builder keeps the real nodes and edges in its
 * state and saves those, so what runs never depends on what is collapsed.
 */

export const GROUP_NODE_PREFIX = "group:";
export const FRAME_NODE_PREFIX = "frame:";
const VIEW_EDGE_PREFIX = "view:";
/** Room around the steps of an expanded group, and for its header. */
export const FRAME_PAD = 24;
export const FRAME_HEADER = 44;

export type GroupRunStatus = "running" | "succeeded" | "failed";

export interface GroupViewData extends Record<string, unknown> {
  groupId: string;
  name: string;
  description?: string | undefined;
  icon?: string | undefined;
  stepCount: number;
  aiCount: number;
  collapsed: boolean;
  /** Aggregated from the steps' run status: any failure wins, then running. */
  status?: GroupRunStatus | undefined;
  /** Label of the first step that failed, to say where without expanding. */
  failedStep?: string | undefined;
  /** Validation problems of the steps inside, so a collapsed block does not hide them. */
  issueCount: number;
}

export interface GroupViewInput {
  /** The builder's nodes, already decorated (badge, class, nature). */
  nodes: readonly Node[];
  edges: readonly Edge[];
  groups: readonly FlowGroup[];
  expanded: ReadonlySet<string>;
  runStatus?: Readonly<Record<string, GroupRunStatus | undefined>> | undefined;
  /** Validation messages per step id. */
  issues?: Readonly<Record<string, readonly string[] | undefined>> | undefined;
  /** Estimated size of a step, used until React Flow has measured it. */
  sizeOf: (n: Node) => { width: number; height: number };
}

export interface GroupView {
  nodes: Node[];
  edges: Edge[];
  /** Step id -> the collapsed group that hides it. */
  hiddenBy: Map<string, string>;
}

export const groupNodeId = (groupId: string) => `${GROUP_NODE_PREFIX}${groupId}`;
export const frameNodeId = (groupId: string) => `${FRAME_NODE_PREFIX}${groupId}`;

/** The group id behind a block or frame node id, or null for a step. */
export function groupIdOfViewNode(id: string): string | null {
  if (id.startsWith(GROUP_NODE_PREFIX)) return id.slice(GROUP_NODE_PREFIX.length);
  if (id.startsWith(FRAME_NODE_PREFIX)) return id.slice(FRAME_NODE_PREFIX.length);
  return null;
}

const labelOf = (n: Node) => {
  const label = (n.data as { label?: unknown } | undefined)?.label;
  return typeof label === "string" && label.trim() ? label : n.id;
};

function box(members: readonly Node[], sizeOf: GroupViewInput["sizeOf"]) {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const n of members) {
    const size = sizeOf(n);
    const w = n.measured?.width ?? size.width;
    const h = n.measured?.height ?? size.height;
    x1 = Math.min(x1, n.position.x);
    y1 = Math.min(y1, n.position.y);
    x2 = Math.max(x2, n.position.x + w);
    y2 = Math.max(y2, n.position.y + h);
  }
  return { x1, y1, x2, y2 };
}

function aggregate(
  group: FlowGroup,
  members: readonly Node[],
  input: GroupViewInput,
  collapsed: boolean
): GroupViewData {
  const statuses = members.map((n) => input.runStatus?.[n.id]);
  const failed = members.find((n) => input.runStatus?.[n.id] === "failed");
  const status: GroupRunStatus | undefined = failed
    ? "failed"
    : statuses.includes("running")
      ? "running"
      : statuses.includes("succeeded")
        ? "succeeded"
        : undefined;
  return {
    groupId: group.id,
    name: group.name,
    description: group.description,
    icon: group.icon,
    stepCount: members.length,
    aiCount: members.filter((n) => nodeNature({ type: String(n.type) }) === "ai").length,
    collapsed,
    status,
    failedStep: failed ? labelOf(failed) : undefined,
    issueCount: members.reduce((sum, n) => sum + (input.issues?.[n.id]?.length ?? 0), 0),
  };
}

export function projectGroups(input: GroupViewInput): GroupView {
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const hiddenBy = new Map<string, string>();
  const frames: Node[] = [];
  const blocks: Node[] = [];

  for (const group of input.groups) {
    const members = group.nodeIds
      .map((id) => byId.get(id))
      .filter((n): n is Node => n !== undefined);
    if (members.length === 0) continue;
    const collapsed = !input.expanded.has(group.id);
    const data = aggregate(group, members, input, collapsed);
    const b = box(members, input.sizeOf);
    if (collapsed) {
      members.forEach((n) => hiddenBy.set(n.id, group.id));
      blocks.push({
        id: groupNodeId(group.id),
        type: "flowGroup",
        position: { x: b.x1, y: b.y1 },
        data,
        deletable: false,
        ...(data.status === "failed"
          ? { className: "flow-node-fail" }
          : data.status === "running"
            ? { className: "flow-node-running" }
            : data.status === "succeeded"
              ? { className: "flow-node-ok" }
              : {}),
      });
    } else {
      frames.push({
        id: frameNodeId(group.id),
        type: "flowGroupFrame",
        position: { x: b.x1 - FRAME_PAD, y: b.y1 - FRAME_PAD - FRAME_HEADER },
        data,
        style: {
          width: b.x2 - b.x1 + FRAME_PAD * 2,
          height: b.y2 - b.y1 + FRAME_PAD * 2 + FRAME_HEADER,
        },
        zIndex: -1,
        selectable: false,
        deletable: false,
        connectable: false,
        dragHandle: ".flow-group-drag",
      });
    }
  }

  const visible = input.nodes.filter((n) => !hiddenBy.has(n.id));
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const e of input.edges) {
    const sourceGroup = hiddenBy.get(e.source);
    const targetGroup = hiddenBy.get(e.target);
    if (!sourceGroup && !targetGroup) {
      edges.push(e);
      continue;
    }
    // Both ends inside the same collapsed group: it is part of the block.
    if (sourceGroup && sourceGroup === targetGroup) continue;
    const source = sourceGroup ? groupNodeId(sourceGroup) : e.source;
    const target = targetGroup ? groupNodeId(targetGroup) : e.target;
    // A block has one way out; the step's own handle (true/false, try...) is
    // not on the block, so a rerouted edge leaves from the block itself.
    const sourceHandle = sourceGroup ? undefined : (e.sourceHandle ?? undefined);
    const key = `${source}|${sourceHandle ?? ""}|${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      id: `${VIEW_EDGE_PREFIX}${e.id}`,
      source,
      target,
      ...(sourceHandle ? { sourceHandle } : {}),
      ...(e.label !== undefined ? { label: e.label } : {}),
      deletable: false,
      selectable: false,
    });
  }

  // Frames first so they are drawn behind the steps they surround.
  return { nodes: [...frames, ...visible, ...blocks], edges, hiddenBy };
}

/** The group a step belongs to, if any. */
export function groupOfStep(groups: readonly FlowGroup[], nodeId: string): FlowGroup | undefined {
  const id = groupOfNode(groups).get(nodeId);
  return id ? groups.find((g) => g.id === id) : undefined;
}

/**
 * Why the selected steps cannot be grouped, or null when they can. Nested
 * groups are not supported, so a step that already has a group is refused.
 */
export function groupingProblem(
  groups: readonly FlowGroup[],
  selectedIds: readonly string[]
): "too_few" | "already_grouped" | null {
  if (selectedIds.length < 2) return "too_few";
  const owner = groupOfNode(groups);
  return selectedIds.some((id) => owner.has(id) || groupIdOfViewNode(id) !== null)
    ? "already_grouped"
    : null;
}
