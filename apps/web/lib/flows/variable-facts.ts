import type { StoredFlowNode } from "./normalize";
import { FLOW_CALL_TYPES } from "./flow-calls";

/**
 * What one step reads from and writes to the flow's variables, read
 * statically from its config. This is the analysis behind `describe_flow`
 * (see the limits documented in `describe.ts`), split out per step so the
 * "extract a group into its own flow" planner uses exactly the same rules.
 *
 * Client-safe on purpose: no database, no registry.
 */

export interface Unresolved {
  nodeId: string;
  reason: string;
}

export interface NodeVariableFacts {
  /** Roots of the variables the step's templates read. */
  reads: string[];
  readsUnknown: Unresolved[];
  writes: string[];
  writesUnknown: Unresolved[];
}

const TEMPLATE = /\{\{([^}]+)\}\}/g;
const ROOT = /^([A-Za-z_][A-Za-z0-9_]*)/;
const LITERAL = /^(["'\d-])/;

/** Default `outputVar` per node type, from the engine's handlers. `meta` also sets `<var>Meta`. */
export const OUTPUT_DEFAULTS: Record<string, { name: string; meta?: boolean }> = {
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

// "Which step calls a flow" has one definition (flow-calls.ts), shared with describe and relations.
export { FLOW_CALL_TYPES };

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export const text = (v: unknown, fallback: string): string =>
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

export function nodeVariableFacts(n: StoredFlowNode): NodeVariableFacts {
  const cfg = n.config;
  const reads = new Set<string>();
  const writes = new Set<string>();
  const readsUnknown: Unresolved[] = [];
  const writesUnknown: Unresolved[] = [];

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
    if (isRecord(cfg.outputs)) Object.keys(cfg.outputs).forEach((k) => writes.add(k));
    else
      writesUnknown.push({
        nodeId: n.id,
        reason: "subflow without outputs merges the child's variables",
      });
  }

  return { reads: [...reads], readsUnknown, writes: [...writes], writesUnknown };
}
