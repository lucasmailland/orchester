import type { Locale } from "./node-registry";
import { normalizeFlowNodes, normalizeFlowEdges, registryIdOf } from "./normalize";
import { validateFlow, type ValidationIssue, type VNode } from "./validate";
import { findTemplateErrors } from "./filters";
import { FLOW_NODE_TYPES } from "./node-types";

/**
 * Validation for flows as they are stored ({ id, type, label, config, ... }),
 * for API and MCP writes. The editor validates its own shape with validateFlow.
 */

const KNOWN_TYPES = new Set<string>([...FLOW_NODE_TYPES, "branch", "handoff"]);
const DONE_SOURCES = new Set(["try_catch", "parallel", "loop_for_each"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (isRecord(value)) Object.values(value).forEach((v) => strings(v, out));
  return out;
}

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.level === "error");
}

export function validateStoredFlow(
  rawNodes: unknown,
  rawEdges: unknown,
  opts: { spec?: string | null; locale?: Locale } = {}
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const raw = Array.isArray(rawNodes) ? rawNodes : [];
  for (const item of raw) {
    const type = isRecord(item) && typeof item.type === "string" ? item.type : "";
    if (!KNOWN_TYPES.has(type)) {
      issues.push({
        level: "error",
        ...(isRecord(item) && typeof item.id === "string" ? { nodeId: item.id } : {}),
        message: `Tipo de paso desconocido: "${type || "sin tipo"}".`,
      });
    }
  }
  if (hasErrors(issues)) return issues;

  const nodes = normalizeFlowNodes(raw);
  const edges = normalizeFlowEdges(rawEdges);
  const vnodes: VNode[] = nodes.map((n) => ({
    id: n.id,
    type: n.type,
    data: {
      nodeId: registryIdOf(n.type, n.config),
      label: n.label,
      config: n.config,
      ...(n.purpose ? { purpose: n.purpose } : {}),
    },
  }));
  issues.push(...validateFlow(vnodes, edges, opts.locale ?? "es", { spec: opts.spec ?? null }));

  for (const n of nodes) {
    for (const s of strings(n.config)) {
      for (const problem of findTemplateErrors(s)) {
        issues.push({
          level: "error",
          nodeId: n.id,
          message: `Variable mal escrita en "${n.label}": ${problem}`,
        });
      }
    }
  }

  // Salidas que el motor exige o da por supuestas. Sin ellas el flow valida
  // limpio y falla recién al correr: `try_catch` tira "missing try branch", y
  // un `loop_for_each` sin cuerpo recorre la lista sin hacer nada y devuelve
  // una lista de vacíos, que es peor porque no se queja.
  const salidas = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!e.sourceHandle) continue;
    const set = salidas.get(e.source) ?? new Set<string>();
    set.add(e.sourceHandle);
    salidas.set(e.source, set);
  }
  for (const n of nodes) {
    const tiene = salidas.get(n.id) ?? new Set<string>();
    if (n.type === "try_catch" && !tiene.has("try")) {
      issues.push({
        level: "error",
        nodeId: n.id,
        message: `"${n.label}" no tiene salida "Intentar": conectá el paso que querés proteger a esa salida, o el flow falla al correr.`,
      });
    }
    if (n.type === "loop_for_each" && !tiene.has("body")) {
      issues.push({
        level: "warning",
        nodeId: n.id,
        message: `"${n.label}" no tiene salida "Cuerpo": va a recorrer la lista sin ejecutar nada.`,
      });
    }
  }

  const typeOf = new Map(nodes.map((n) => [n.id, n.type]));
  for (const e of edges) {
    if (e.sourceHandle === "done" && !DONE_SOURCES.has(typeOf.get(e.source) ?? "")) {
      issues.push({
        level: "error",
        nodeId: e.source,
        message:
          'Sólo "Intentar/Si falla", "En paralelo" y "Por cada uno" tienen la salida "done".',
      });
    }
  }
  return issues;
}
