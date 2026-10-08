import {
  normalizeFlowEdges,
  normalizeFlowNodes,
  type StoredFlowEdge,
  type StoredFlowNode,
} from "./normalize";
import { getNodeDef } from "./node-registry";
import { actionViolations, type ActionViolation } from "./action-contract";
import { normalizeFlowGroups, type FlowGroup, type FlowGroupIcon } from "./groups";
import type { FlowKind } from "./kind";
import { SUBFLOW_IO_MAX_ENTRIES, VARIABLE_NAME } from "./subflow-io";
import {
  FLOW_CALL_TYPES,
  OUTPUT_DEFAULTS,
  nodeVariableFacts,
  text,
  type Unresolved,
} from "./variable-facts";

/**
 * "Extract to flow": move a block of steps into a reusable flow of its own and
 * call it from where the block was, with one `subflow` step.
 *
 * Only a block that runs the same way after the move is extractable:
 *
 * - Exactly one edge enters it and exactly one leaves it, and no step inside
 *   is the trigger.
 * - Every path from the entry reaches the exit, exactly once, as the last
 *   thing the block does: branches (`condition`, `switch`) rejoin before the
 *   exit, a step never continues on several paths at once, nothing inside
 *   ends early, and the exit is not inside a try/loop/parallel branch. The
 *   engine follows edges depth first with no join, so without these rules the
 *   step after the block could run a different number of times, or before
 *   the rest of the block.
 * - No step inside waits for a person: a pause in a called flow cannot resume
 *   the caller.
 *
 * The variable mapping comes from the same per-step analysis as
 * `describe_flow` (`variable-facts.ts`), plus the defaults the engine reads
 * without a template (an Agent step with no message reads `message`):
 *
 * - `inputs`: variables a step inside reads before any step inside has
 *   certainly written them, so they come from earlier steps or the run input.
 *   When a step reads variables the analysis cannot name (JavaScript, a
 *   spreadsheet formula, a subflow without inputs), there is no `inputs` and
 *   the new flow receives every variable, as the block did.
 * - `outputs`: variables produced inside that a later step reads before
 *   writing them itself. When later steps read what cannot be named, every
 *   variable produced inside comes back; when that is unknown too, there is
 *   no `outputs` and everything comes back.
 *
 * Variables produced inside that nothing after the block reads stay in the
 * new flow (`staysInside`): that is the point of an explicit mapping.
 *
 * Pure and client-safe: the editor previews with it and the server applies
 * with it.
 */

export type ExtractionBlockCode =
  | "parent_is_action"
  | "empty"
  | "unknown_group"
  | "unknown_step"
  | "trigger_inside"
  | "wait_human_inside"
  | "group_split"
  | "entries"
  | "exits"
  | "cycle"
  | "branch_ends"
  | "fan_out"
  | "exit_on_branch"
  | "exit_in_branch"
  | "unreachable";

export interface ExtractionBlock {
  code: ExtractionBlockCode;
  nodeId?: string;
  groupId?: string;
  /** For `entries` / `exits`: how many edges there are. */
  count?: number;
}

export type ExtractionNoteCode =
  "created_enabled" | "error_prefix" | "inside_try" | "inside_loop" | "calls_subflows";

export interface ExtractionPlan {
  /** Steps that move, in the order the parent stores them. */
  nodeIds: string[];
  entryEdgeId: string;
  exitEdgeId: string;
  entryNodeId: string;
  exitNodeId: string;
  /** Null: the new flow receives every variable of the caller (see `inputsUnknown`). */
  inputs: string[] | null;
  inputsUnknown: Unresolved[];
  /** Null: every variable of the new flow comes back (see `outputsUnknown`). */
  outputs: string[] | null;
  outputsUnknown: Unresolved[];
  /** Produced inside and not brought back. */
  staysInside: string[];
  /**
   * Steps whose writes cannot be named (a JavaScript step returns an object):
   * what they write that later steps do not read also stays inside.
   */
  staysInsideUnknown: Unresolved[];
  kind: FlowKind;
  /** Why the new flow is a pipeline; empty for an action. */
  kindReasons: ActionViolation[];
  /** Groups entirely inside the block, which move with it. */
  movedGroupIds: string[];
  /** The group being extracted, consumed by the subflow step. */
  sourceGroupId: string | null;
  notes: ExtractionNoteCode[];
}

export type ExtractionResult =
  { ok: true; plan: ExtractionPlan } | { ok: false; blocks: ExtractionBlock[] };

export type ExtractionSelection = { groupId: string } | { nodeIds: readonly string[] };

export interface ExtractionGraph {
  nodes: unknown;
  edges: unknown;
  groups?: unknown;
  /** The parent's kind: an action may not call another flow, so it cannot be split. */
  kind?: unknown;
}

const PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SCOPE_TYPES = new Set(["try_catch", "loop_for_each", "parallel"]);
const DEFINITE_WRITERS = new Set([...Object.keys(OUTPUT_DEFAULTS), "transform"]);

/** Reads the engine performs without a template, which the static facts do not list. */
function implicitReads(n: StoredFlowNode): { reads: string[]; unknown: Unresolved[] } {
  const cfg = n.config;
  const reads: string[] = [];
  const unknown: Unresolved[] = [];
  if (n.type === "agent" && cfg.message == null) reads.push("message");
  if (n.type === "kb_search" && cfg.query == null) reads.push("message");
  if (n.type === "embed_text" && cfg.input == null) reads.push("message");
  if (n.type === "loop_for_each" && typeof cfg.collectVar === "string" && cfg.collectVar) {
    reads.push(cfg.collectVar);
  }
  if (FLOW_CALL_TYPES.has(n.type) && cfg.inputs === undefined) {
    unknown.push({
      nodeId: n.id,
      reason: "subflow without inputs passes every variable to the flow it calls",
    });
  }
  return { reads, unknown };
}

function readsOf(n: StoredFlowNode): { reads: string[]; unknown: Unresolved[] } {
  const facts = nodeVariableFacts(n);
  const implicit = implicitReads(n);
  return {
    reads: [...new Set([...facts.reads, ...implicit.reads])],
    unknown: [...facts.readsUnknown, ...implicit.unknown],
  };
}

/**
 * Variables a step has certainly written when the engine leaves it through
 * `handle`. Under-approximated on purpose (fewer certain writes means more
 * inputs and outputs, never fewer): a subflow mapping may leave a variable
 * untouched, a try branch may not finish, a loop may have no items.
 */
function definiteWrites(n: StoredFlowNode, handle: string | undefined): string[] {
  const cfg = n.config;
  if (n.type === "try_catch") return handle === "catch" ? [text(cfg.errorVar, "error")] : [];
  if (n.type === "loop_for_each") {
    if (handle === "body") return [text(cfg.itemVar, "item")];
    if (handle === "done") return [text(cfg.outputVar, "loopResults")];
    return [];
  }
  const legacyCode = n.type === "code" && !(typeof cfg.code === "string" && cfg.code.trim());
  if (DEFINITE_WRITERS.has(n.type) || legacyCode) return nodeVariableFacts(n).writes;
  return [];
}

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

const mappable = (names: readonly string[]) =>
  names.length <= SUBFLOW_IO_MAX_ENTRIES &&
  names.every((v) => VARIABLE_NAME.test(v) && !PROTO_KEYS.has(v));

export function planExtraction(
  graph: ExtractionGraph,
  selection: ExtractionSelection
): ExtractionResult {
  const nodes = normalizeFlowNodes(graph.nodes);
  const edges = normalizeFlowEdges(graph.edges);
  const groups = normalizeFlowGroups(graph.groups);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const blocks: ExtractionBlock[] = [];
  const seenBlocks = new Set<string>();
  const block = (b: ExtractionBlock) => {
    const key = `${b.code}|${b.nodeId ?? ""}|${b.groupId ?? ""}`;
    if (seenBlocks.has(key)) return;
    seenBlocks.add(key);
    blocks.push(b);
  };
  const refuse = (): ExtractionResult => ({ ok: false, blocks });
  if (graph.kind === "action") {
    block({ code: "parent_is_action" });
    return refuse();
  }

  let sourceGroupId: string | null = null;
  let selected: string[];
  if ("groupId" in selection) {
    const group = groups.find((g) => g.id === selection.groupId);
    if (!group) {
      block({ code: "unknown_group", groupId: selection.groupId });
      return refuse();
    }
    sourceGroupId = group.id;
    selected = [...group.nodeIds];
  } else {
    selected = [...new Set(selection.nodeIds)];
  }
  if (selected.length === 0) {
    block({ code: "empty" });
    return refuse();
  }
  for (const id of selected) if (!byId.has(id)) block({ code: "unknown_step", nodeId: id });
  if (blocks.length) return refuse();

  const inB = new Set(selected);
  for (const id of selected) {
    const type = byId.get(id)!.type;
    if (type === "trigger") block({ code: "trigger_inside", nodeId: id });
    if (type === "wait_human") block({ code: "wait_human_inside", nodeId: id });
  }
  for (const g of groups) {
    const inside = g.nodeIds.filter((id) => inB.has(id)).length;
    if (inside > 0 && inside < g.nodeIds.length) block({ code: "group_split", groupId: g.id });
  }
  const entryEdges = edges.filter((e) => !inB.has(e.source) && inB.has(e.target));
  const exitEdges = edges.filter((e) => inB.has(e.source) && !inB.has(e.target));
  if (entryEdges.length !== 1) block({ code: "entries", count: entryEdges.length });
  if (exitEdges.length !== 1) block({ code: "exits", count: exitEdges.length });
  if (blocks.length) return refuse();

  const entryEdge = entryEdges[0]!;
  const exitEdge = exitEdges[0]!;
  const entry = entryEdge.target;
  const exit = exitEdge.source;
  const internal = edges.filter((e) => inB.has(e.source) && inB.has(e.target));
  const outOf = (id: string) =>
    edges.filter((e) => e.source === id && (inB.has(e.target) || e === exitEdge));

  /** Steps reachable from `start` through edges inside the block. */
  const closureInside = (start: string) => {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const e of internal) if (e.source === id) stack.push(e.target);
    }
    return seen;
  };

  /** Edges that run inside the step (try/catch/body/parallel branches). */
  const nestedEdges = (n: StoredFlowNode) => {
    const out = outOf(n.id);
    if (n.type === "try_catch")
      return out.filter((e) => ["try", "catch"].includes(e.sourceHandle ?? ""));
    if (n.type === "loop_for_each") return out.filter((e) => e.sourceHandle === "body");
    if (n.type === "parallel") return out.filter((e) => e.sourceHandle !== "done");
    return [];
  };

  /** Each way the engine can continue after the step; each must be exactly one edge. */
  const alternatives = (n: StoredFlowNode): StoredFlowEdge[][] => {
    const out = outOf(n.id);
    if (n.type === "end") return [];
    if (n.type === "condition")
      return ["true", "false"].map((h) => out.filter((e) => e.sourceHandle === h));
    if (n.type === "switch") {
      // An unmatched value goes to "default"; without that edge the path ends.
      const handles = sorted([...out.map((e) => e.sourceHandle ?? ""), "default"].filter(Boolean));
      return handles.map((h) => out.filter((e) => e.sourceHandle === h));
    }
    if (SCOPE_TYPES.has(n.type)) return [out.filter((e) => e.sourceHandle === "done")];
    return [out];
  };

  const visited = new Set<string>();
  const done = new Set<string>();
  const onPath = new Set<string>();
  let exitTaken = false;
  const walk = (id: string) => {
    if (done.has(id)) return;
    if (onPath.has(id)) {
      block({ code: "cycle", nodeId: id });
      return;
    }
    onPath.add(id);
    visited.add(id);
    const n = byId.get(id)!;
    for (const e of nestedEdges(n)) {
      if (e === exitEdge) {
        block({ code: "exit_in_branch", nodeId: id });
        continue;
      }
      const reach = closureInside(e.target);
      if (reach.has(exit)) block({ code: "exit_in_branch", nodeId: id });
      if (reach.has(id)) block({ code: "cycle", nodeId: id });
      reach.forEach((r) => visited.add(r));
    }
    const alts = alternatives(n);
    if (alts.length === 0) block({ code: "branch_ends", nodeId: id });
    for (const alt of alts) {
      if (alt.length === 0) {
        block({ code: "branch_ends", nodeId: id });
        continue;
      }
      if (alt.length > 1) {
        block({ code: "fan_out", nodeId: id });
        // Still walked, so the steps behind the split are not also reported as unreachable.
        for (const x of alt) if (x !== exitEdge) walk(x.target);
        continue;
      }
      const e = alt[0]!;
      if (e === exitEdge) {
        if (alts.length > 1) block({ code: "exit_on_branch", nodeId: id });
        else exitTaken = true;
        continue;
      }
      walk(e.target);
    }
    onPath.delete(id);
    done.add(id);
  };
  walk(entry);
  if (!exitTaken && blocks.length === 0) block({ code: "exit_on_branch", nodeId: exit });
  for (const id of selected) {
    if (!visited.has(id) && byId.get(id)!.type !== "note")
      block({ code: "unreachable", nodeId: id });
  }
  if (blocks.length) return refuse();

  /**
   * Reads in `region` that may see a value from before `start`: a forward
   * pass of "certainly written" sets, intersected where paths meet.
   */
  const exposedReads = (region: ReadonlySet<string>, start: string) => {
    const regionEdges = edges.filter((e) => region.has(e.source) && region.has(e.target));
    const defIn = new Map<string, Set<string>>([[start, new Set()]]);
    const work = [start];
    while (work.length) {
      const id = work.pop()!;
      const n = byId.get(id)!;
      const din = defIn.get(id)!;
      for (const e of regionEdges) {
        if (e.source !== id) continue;
        const out = new Set([...din, ...definiteWrites(n, e.sourceHandle)]);
        const cur = defIn.get(e.target);
        if (!cur) {
          defIn.set(e.target, out);
          work.push(e.target);
        } else {
          const meet = new Set([...cur].filter((v) => out.has(v)));
          if (meet.size !== cur.size) {
            defIn.set(e.target, meet);
            work.push(e.target);
          }
        }
      }
    }
    const reads = new Set<string>();
    const unknown: Unresolved[] = [];
    for (const id of region) {
      const r = readsOf(byId.get(id)!);
      const certain = defIn.get(id) ?? new Set<string>();
      r.reads.filter((v) => !certain.has(v)).forEach((v) => reads.add(v));
      unknown.push(...r.unknown);
    }
    return { reads, unknown };
  };

  /** Everything reachable from `start` through any edge, in the whole parent. */
  const closureAll = (start: string, skip: ReadonlySet<string> = new Set()) => {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id) || skip.has(id)) continue;
      seen.add(id);
      for (const e of edges) if (e.source === id) stack.push(e.target);
    }
    return seen;
  };
  const enclosing = (type: string, handles: readonly string[]) =>
    nodes.some(
      (n) =>
        n.type === type &&
        !inB.has(n.id) &&
        edges.some(
          (e) =>
            e.source === n.id &&
            handles.includes(e.sourceHandle ?? "") &&
            closureAll(e.target).has(entry)
        )
    );
  const insideLoop = enclosing("loop_for_each", ["body"]);
  const insideTry = enclosing("try_catch", ["try"]);

  // Inputs.
  const inside = exposedReads(inB, entry);
  let inputs: string[] | null = null;
  let inputsUnknown: Unresolved[] = inside.unknown;
  if (inside.unknown.length === 0) {
    const names = sorted(inside.reads);
    if (mappable(names)) inputs = names;
    else inputsUnknown = [{ nodeId: entry, reason: "inputs cannot be listed as a mapping" }];
  }

  // Outputs.
  const blockNodes = nodes.filter((n) => inB.has(n.id));
  const writes = new Set<string>();
  const writesUnknown: Unresolved[] = [];
  for (const n of blockNodes) {
    const f = nodeVariableFacts(n);
    f.writes.forEach((v) => writes.add(v));
    writesUnknown.push(...f.writesUnknown);
  }
  let after: { reads: Set<string>; unknown: Unresolved[] };
  if (insideLoop) {
    // The block runs again on the next item: any step outside may read what it left.
    after = { reads: new Set(), unknown: [] };
    for (const n of nodes) {
      if (inB.has(n.id)) continue;
      const r = readsOf(n);
      r.reads.forEach((v) => after.reads.add(v));
      after.unknown.push(...r.unknown);
    }
  } else {
    after = exposedReads(closureAll(exitEdge.target, inB), exitEdge.target);
  }
  let outputs: string[] | null;
  let outputsUnknown: Unresolved[] = [];
  if (after.unknown.length > 0 && writesUnknown.length > 0) {
    outputs = null;
    outputsUnknown = [...writesUnknown, ...after.unknown];
  } else if (after.unknown.length > 0) {
    outputs = sorted(writes);
  } else if (writesUnknown.length > 0) {
    outputs = sorted(after.reads);
  } else {
    outputs = sorted([...after.reads].filter((v) => writes.has(v)));
  }
  if (outputs && !mappable(outputs)) {
    outputs = null;
    outputsUnknown = [{ nodeId: exit, reason: "outputs cannot be listed as a mapping" }];
  }
  const staysInside = outputs ? sorted([...writes].filter((v) => !outputs!.includes(v))) : [];
  const staysInsideUnknown = outputs ? writesUnknown : [];

  const kindReasons = actionViolations(blockNodes, {});
  const notes: ExtractionNoteCode[] = ["created_enabled", "error_prefix"];
  if (insideTry) notes.push("inside_try");
  if (insideLoop) notes.push("inside_loop");
  if (blockNodes.some((n) => FLOW_CALL_TYPES.has(n.type))) notes.push("calls_subflows");

  return {
    ok: true,
    plan: {
      nodeIds: blockNodes.map((n) => n.id),
      entryEdgeId: entryEdge.id,
      exitEdgeId: exitEdge.id,
      entryNodeId: entry,
      exitNodeId: exit,
      inputs,
      inputsUnknown,
      outputs,
      outputsUnknown,
      staysInside,
      staysInsideUnknown,
      kind: kindReasons.length > 0 ? "pipeline" : "action",
      kindReasons,
      movedGroupIds: groups
        .filter((g) => g.id !== sourceGroupId && g.nodeIds.every((id) => inB.has(id)))
        .map((g) => g.id),
      sourceGroupId,
      notes,
    },
  };
}

export interface ExtractionMeta {
  name: string;
  description?: string | undefined;
  icon?: FlowGroupIcon | undefined;
}

export interface ExtractionIds {
  childFlowId: string;
  subflowNodeId: string;
}

export interface ExtractedGraph {
  nodes: StoredFlowNode[];
  edges: StoredFlowEdge[];
  groups: FlowGroup[];
}

const CHILD_X = 280;
const CHILD_Y = 80;

function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let i = 1;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

/**
 * The two graphs an extraction leaves: the parent with one `subflow` step in
 * place of the block, and the new flow with a manual trigger and the moved
 * steps. Edge order inside the block is kept, which is the order the engine
 * follows them in.
 */
export function buildExtraction(
  graph: ExtractionGraph,
  plan: ExtractionPlan,
  meta: ExtractionMeta,
  ids: ExtractionIds
): { parent: ExtractedGraph; child: ExtractedGraph } {
  const nodes = normalizeFlowNodes(graph.nodes);
  const edges = normalizeFlowEdges(graph.edges);
  const groups = normalizeFlowGroups(graph.groups);
  const inB = new Set(plan.nodeIds);
  const moved = nodes.filter((n) => inB.has(n.id));
  const minX = Math.min(...moved.map((n) => n.position.x));
  const minY = Math.min(...moved.map((n) => n.position.y));

  const config: Record<string, unknown> = { flowId: ids.childFlowId };
  if (plan.inputs) config.inputs = Object.fromEntries(plan.inputs.map((v) => [v, `{{${v}}}`]));
  if (plan.outputs) config.outputs = Object.fromEntries(plan.outputs.map((v) => [v, v]));
  // Presentation only, like the group it replaces; the engine ignores it.
  if (meta.icon) config.icon = meta.icon;
  const description = meta.description?.trim();
  const subflowNode: StoredFlowNode = {
    id: ids.subflowNodeId,
    type: "subflow",
    label: meta.name,
    config,
    position: { x: minX, y: minY },
    ...(description ? { purpose: description } : {}),
  };

  const parentNodes: StoredFlowNode[] = [];
  for (const n of nodes) {
    if (n.id === plan.entryNodeId) parentNodes.push(subflowNode);
    else if (!inB.has(n.id)) parentNodes.push(n);
  }
  const parentEdges: StoredFlowEdge[] = [];
  for (const e of edges) {
    if (e.id === plan.entryEdgeId) parentEdges.push({ ...e, target: ids.subflowNodeId });
    else if (e.id === plan.exitEdgeId) {
      // A subflow step has one way out; the handle belonged to the step inside.
      parentEdges.push({
        id: e.id,
        source: ids.subflowNodeId,
        target: e.target,
        ...(e.label !== undefined ? { label: e.label } : {}),
      });
    } else if (!inB.has(e.source) && !inB.has(e.target)) parentEdges.push(e);
  }
  const leaving = new Set([plan.sourceGroupId, ...plan.movedGroupIds]);

  const taken = new Set(moved.map((n) => n.id));
  const triggerId = uniqueId("trigger", taken);
  const entryNode = moved.find((n) => n.id === plan.entryNodeId)!;
  const trigger: StoredFlowNode = {
    id: triggerId,
    type: "trigger",
    label: getNodeDef("trigger_manual")?.title.es ?? "Inicio manual",
    config: { triggerKind: "manual" },
    position: { x: 0, y: entryNode.position.y - minY + CHILD_Y },
  };
  const childNodes = [
    trigger,
    ...moved.map((n) => ({
      ...n,
      position: { x: n.position.x - minX + CHILD_X, y: n.position.y - minY + CHILD_Y },
    })),
  ];
  const internal = edges.filter((e) => inB.has(e.source) && inB.has(e.target));
  const edgeIds = new Set(internal.map((e) => e.id));
  const childEdges: StoredFlowEdge[] = [
    { id: uniqueId(`e-${triggerId}`, edgeIds), source: triggerId, target: plan.entryNodeId },
    ...internal,
  ];

  return {
    parent: {
      nodes: parentNodes,
      edges: parentEdges,
      groups: groups.filter((g) => !leaving.has(g.id)),
    },
    child: {
      nodes: childNodes,
      edges: childEdges,
      groups: groups.filter((g) => plan.movedGroupIds.includes(g.id)),
    },
  };
}

/** Markdown documentation for the new flow, written from the plan (nothing generated). */
export function extractionSpec(plan: ExtractionPlan, meta: ExtractionMeta, parentName: string) {
  const list = (names: string[] | null, all: string) =>
    names === null ? all : names.length ? names.map((v) => `- \`${v}\``).join("\n") : "- (none)";
  return [
    "## Purpose",
    meta.description?.trim() || meta.name,
    "",
    "## Origin",
    `Extracted from the flow "${parentName}", which calls it through a subflow step.`,
    "",
    "## Inputs",
    list(plan.inputs, "- Every variable of the calling flow."),
    "",
    "## Outputs",
    list(plan.outputs, "- Every variable this flow ends with."),
  ].join("\n");
}

/** Why a block cannot be extracted, in plain English, for API and MCP callers. */
export function extractionBlockMessage(b: ExtractionBlock): string {
  const step = b.nodeId ? `"${b.nodeId}"` : "a step";
  switch (b.code) {
    case "parent_is_action":
      return "This flow is an action, and actions cannot call other flows. Make it a pipeline first.";
    case "empty":
      return "Choose the steps to extract.";
    case "unknown_group":
      return `There is no group "${b.groupId ?? ""}" in this flow.`;
    case "unknown_step":
      return `Step ${step} is not in this flow.`;
    case "trigger_inside":
      return `Step ${step} is the trigger; it stays in this flow.`;
    case "wait_human_inside":
      return `Step ${step} waits for a person; a pause inside a called flow cannot resume this one.`;
    case "group_split":
      return `The selection takes only part of group "${b.groupId ?? ""}"; take all of it or none.`;
    case "entries":
      return `Exactly one connection must enter the steps; there are ${b.count ?? 0}.`;
    case "exits":
      return `Exactly one connection must leave the steps; there are ${b.count ?? 0}.`;
    case "cycle":
      return `Step ${step} leads back to itself.`;
    case "branch_ends":
      return `A path from step ${step} ends inside the steps instead of reaching the way out.`;
    case "fan_out":
      return `Step ${step} continues on several paths at once.`;
    case "exit_on_branch":
      return `The way out is taken on only one branch of step ${step}; every branch must rejoin first.`;
    case "exit_in_branch":
      return `The way out is inside a try, loop or parallel branch of step ${step}.`;
    case "unreachable":
      return `Step ${step} is never reached from where the steps start.`;
  }
}
