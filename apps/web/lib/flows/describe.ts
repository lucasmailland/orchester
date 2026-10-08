import { computeBlockers } from "./delete-impact";
import { readExternalCallers, type ExternalCaller, type FlowKind } from "./kind";
import { nodeNature, type NodeNature } from "./node-nature";
import { normalizeFlowNodes } from "./normalize";
import { actionContractIssues } from "./validate-stored";
import type { ValidationIssue } from "./validate";

/**
 * Flow "fact sheet": what a flow is, computed from its graph so it cannot
 * drift from it. Pure and client-safe apart from what `validate-stored`
 * already imports; the DB-bound loading lives in `describe-load.ts`.
 *
 * Variable extraction is conservative and static. Limits, on purpose:
 * - Reads come from `{{expression}}` templates found anywhere in a node's
 *   config (the engine's own syntax: path, then `| filters`). The root of the
 *   path is the variable. An expression whose root cannot be read (`['k']`)
 *   is listed under `unknown`, never dropped.
 * - Bare-name configs the engine reads without braces (a legacy loop's
 *   `arrayVar`) count as reads. Spreadsheet formulas and grids reference
 *   variables by name inside a formula language, and the JavaScript `code`
 *   step reads `input.*`: those nodes are listed under `reads.unknown`
 *   (templates inside them are still extracted).
 * - Writes come from each node's `outputVar` (or the engine's default for
 *   that node type), the legacy `transform` target, the top-level keys of a
 *   `transform` template, legacy `code` `set x = ...` lines, loop/try_catch
 *   variables and the keys of a subflow's `outputs` mapping.
 * - Writes that cannot be named statically go under `writes.unknown`: a
 *   subflow without `outputs` (it merges the child's whole bag), a JavaScript
 *   `code` step (it returns an object) and a `transform` template that is not
 *   a literal object.
 * - Order is ignored: a variable set anywhere in the flow is not a read, even
 *   if a step reads it before the step that sets it. Flow-level default
 *   `variables` are not subtracted either: they are overridable inputs.
 * - A subflow's `outputs` expressions run against the CHILD's variables, so
 *   they are not reads of this flow; its `inputs` expressions are.
 */

export interface DescribeNodeRef {
  nodeId: string;
  label: string;
  type: string;
}

export interface DescribeAiStep extends DescribeNodeRef {
  agentId?: string;
  model?: string;
}

export interface Unresolved {
  nodeId: string;
  reason: string;
}

export type ActionEffectFact = "read" | "write" | "unknown";

export interface FlowSheet {
  flowId: string;
  kind: FlowKind;
  enabled: boolean;
  externalCallers: ExternalCaller[];
  steps: {
    total: number;
    counts: Record<NodeNature, number>;
    ai: DescribeAiStep[];
    human: DescribeNodeRef[];
  };
  reads: { variables: string[]; unknown: Unresolved[] };
  writes: { variables: string[]; unknown: Unresolved[] };
  calls: {
    subflows: Array<{ nodeId: string; flowId: string; inputs: string[]; outputs: string[] }>;
    integrations: Array<{
      nodeId: string;
      integration: string;
      action: string;
      effect: ActionEffectFact;
    }>;
  };
  calledBy: {
    flows: Array<{ id: string; name: string }>;
    externalCallers: ExternalCaller[];
    webhooks: Array<{ id: string; enabled: boolean }>;
  };
  /** Action-contract issues for `kind = action`; always empty for pipelines. */
  contract: ValidationIssue[];
}

/** A flow as stored. Graph fields are untrusted JSON. */
export interface DescribeFlowInput {
  id: string;
  name: string;
  enabled: boolean;
  kind?: string | null | undefined;
  externalCallers?: unknown;
  nodes: unknown;
  edges: unknown;
  variables: unknown;
}

export interface DescribeContext {
  /** Every flow of the workspace (the described one is ignored), to find its callers. */
  otherFlows: Array<{ id: string; name: string; nodes: unknown }>;
  webhooks: Array<{ id: string; enabled: boolean }>;
  /**
   * Effect per integration node id, resolved by the loader (it depends on the
   * step's input). Missing means `unknown`: never guessed.
   */
  effects: Readonly<Record<string, "read" | "write" | undefined>>;
}

const TEMPLATE = /\{\{([^}]+)\}\}/g;
const ROOT = /^([A-Za-z_][A-Za-z0-9_]*)/;
const LITERAL = /^(["'\d-])/;

/** Default `outputVar` per node type, from the engine's handlers. `meta` also sets `<var>Meta`. */
const OUTPUT_DEFAULTS: Record<string, { name: string; meta?: boolean }> = {
  agent: { name: "agentResult", meta: true },
  http: { name: "httpResult" },
  kb_search: { name: "knowledge" },
  generate_image: { name: "image" },
  embed_text: { name: "vector" },
  llm_prompt: { name: "texto", meta: true },
  generate_video: { name: "video" },
  text_to_speech: { name: "audio" },
  transcribe: { name: "texto" },
  generate_avatar: { name: "video" },
  generate_music: { name: "musica" },
  ocr_extract: { name: "texto" },
  rerank: { name: "ranked" },
  integration: { name: "appResult" },
  spreadsheet: { name: "result" },
};

const FLOW_CALL_TYPES = new Set(["subflow", "flow_call"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const text = (v: unknown, fallback: string): string =>
  typeof v === "string" && v.trim() ? v.trim() : fallback;

/** Every string in a config, optionally skipping top-level keys. */
function strings(value: unknown, skip: ReadonlySet<string> = new Set(), out: string[] = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, new Set(), out));
  else if (isRecord(value)) {
    for (const [k, v] of Object.entries(value)) if (!skip.has(k)) strings(v, new Set(), out);
  }
  return out;
}

function parseTemplateObject(value: unknown): Record<string, unknown> | "dynamic" {
  let tpl = value;
  if (typeof tpl === "string") {
    try {
      tpl = JSON.parse(tpl);
    } catch {
      return "dynamic";
    }
  }
  return isRecord(tpl) ? tpl : "dynamic";
}

export function describeFlow(flow: DescribeFlowInput, ctx: DescribeContext): FlowSheet {
  const nodes = normalizeFlowNodes(flow.nodes);
  const kind: FlowKind = flow.kind === "action" ? "action" : "pipeline";
  const externalCallers = readExternalCallers(flow.externalCallers);

  const counts: Record<NodeNature, number> = { ai: 0, code: 0, human: 0, control: 0 };
  const ai: DescribeAiStep[] = [];
  const human: DescribeNodeRef[] = [];
  const reads = new Set<string>();
  const writes = new Set<string>();
  const readsUnknown: Unresolved[] = [];
  const writesUnknown: Unresolved[] = [];
  const subflows: FlowSheet["calls"]["subflows"] = [];
  const integrations: FlowSheet["calls"]["integrations"] = [];

  for (const n of nodes) {
    const cfg = n.config;
    const label = n.label || n.id;
    const nature = nodeNature(n);
    counts[nature]++;
    if (nature === "ai") {
      const step: DescribeAiStep = { nodeId: n.id, label, type: n.type };
      if (typeof cfg.agentId === "string" && cfg.agentId) step.agentId = cfg.agentId;
      if (typeof cfg.model === "string" && cfg.model) step.model = cfg.model;
      ai.push(step);
    } else if (nature === "human") {
      human.push({ nodeId: n.id, label, type: n.type });
    }

    // Reads: templates anywhere in the config. A subflow's `outputs` run on the child.
    const skip = new Set(FLOW_CALL_TYPES.has(n.type) ? ["outputs"] : []);
    for (const s of strings(cfg, skip)) {
      for (const m of s.matchAll(TEMPLATE)) {
        const path = (m[1] ?? "").split("|")[0]?.trim() ?? "";
        const root = ROOT.exec(path)?.[1];
        if (root) reads.add(root);
        else if (!LITERAL.test(path)) {
          readsUnknown.push({ nodeId: n.id, reason: `unreadable expression {{${path}}}` });
        }
      }
    }
    if (n.type === "loop_for_each" && cfg.items === undefined) {
      reads.add(text(cfg.arrayVar, "items"));
    }
    if (n.type === "spreadsheet" && (cfg.formula || cfg.grid)) {
      readsUnknown.push({ nodeId: n.id, reason: "spreadsheet formulas name variables freely" });
    }
    if (n.type === "code" && typeof cfg.code === "string" && cfg.code.trim()) {
      readsUnknown.push({ nodeId: n.id, reason: "javascript step reads input.*" });
      writesUnknown.push({ nodeId: n.id, reason: "javascript step returns an object" });
    }

    // Writes.
    const def = OUTPUT_DEFAULTS[n.type];
    if (def) {
      const name = text(cfg.outputVar, def.name);
      writes.add(name);
      if (def.meta) writes.add(`${name}Meta`);
    }
    if (n.type === "transform") {
      if (cfg.template !== undefined) {
        const tpl = parseTemplateObject(cfg.template);
        if (tpl === "dynamic") {
          writesUnknown.push({ nodeId: n.id, reason: "template is not a literal object" });
        } else {
          Object.keys(tpl).forEach((k) => writes.add(k));
        }
      } else {
        writes.add(text(cfg.target, "result"));
      }
    }
    if (n.type === "code" && !(typeof cfg.code === "string" && cfg.code.trim())) {
      for (const line of String(cfg.source ?? "").split("\n")) {
        const m = /^\s*set\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/.exec(line);
        if (m?.[1]) writes.add(m[1]);
      }
    }
    if (n.type === "loop_for_each") {
      writes.add(text(cfg.itemVar, "item"));
      writes.add(text(cfg.outputVar, "loopResults"));
    }
    if (n.type === "try_catch") writes.add(text(cfg.errorVar, "error"));

    if (FLOW_CALL_TYPES.has(n.type)) {
      const inputs = isRecord(cfg.inputs) ? Object.keys(cfg.inputs).sort() : [];
      const outputs = isRecord(cfg.outputs) ? Object.keys(cfg.outputs).sort() : [];
      subflows.push({ nodeId: n.id, flowId: text(cfg.flowId, ""), inputs, outputs });
      if (isRecord(cfg.outputs)) outputs.forEach((k) => writes.add(k));
      else
        writesUnknown.push({
          nodeId: n.id,
          reason: "subflow without outputs merges the child's variables",
        });
    }
    if (n.type === "integration") {
      const raw = text(cfg.integrationId, "");
      const [integration = "", action = ""] = raw.split("::");
      const effect = ctx.effects[n.id];
      integrations.push({
        nodeId: n.id,
        integration: action ? integration : "",
        action,
        effect: action && (effect === "read" || effect === "write") ? effect : "unknown",
      });
    }
  }

  const callers = computeBlockers({
    flow: {
      id: flow.id,
      name: flow.name,
      enabled: flow.enabled,
      externalCallers: flow.externalCallers,
    },
    agents: [],
    otherFlows: ctx.otherFlows.filter((f) => f.id !== flow.id),
    counts: { runs: 0, versions: 0, webhooks: 0, schedules: 0 },
  });

  return {
    flowId: flow.id,
    kind,
    enabled: flow.enabled,
    externalCallers,
    steps: { total: nodes.length, counts, ai, human },
    reads: {
      variables: [...reads].filter((v) => !writes.has(v)).sort(),
      unknown: readsUnknown,
    },
    writes: { variables: [...writes].sort(), unknown: writesUnknown },
    calls: { subflows, integrations },
    calledBy: {
      flows: callers.flows,
      externalCallers: callers.externalCallers,
      webhooks: ctx.webhooks.map((w) => ({ id: w.id, enabled: w.enabled })),
    },
    contract: kind === "action" ? actionContractIssues(nodes, flow.variables) : [],
  };
}
