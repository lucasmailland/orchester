import { getNodeDef, type Locale } from "./node-registry";
import type { FieldDef } from "./field-types";

/**
 * Validación del flujo en lenguaje simple. Pura y testeable. Detecta problemas
 * comunes (sin inicio, campos sin completar, pasos sueltos, conexiones rotas) y
 * los explica para que cualquier persona los entienda.
 */

export interface ValidationIssue {
  level: "error" | "warning";
  message: string;
  nodeId?: string;
}

export interface VNode {
  id: string;
  type?: string | undefined;
  data?: { nodeId?: string; label?: string; config?: Record<string, unknown> } | undefined;
}
export interface VEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | undefined;
}

function isEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

function fieldVisible(f: FieldDef, config: Record<string, unknown>): boolean {
  return !f.dependsOn || String(config[f.dependsOn.key] ?? "") === f.dependsOn.value;
}

export function validateFlow(nodes: VNode[], edges: VEdge[], locale: Locale = "es"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const labelOf = (n: VNode) => {
    if (n.data?.label) return n.data.label;
    const def = getNodeDef(String(n.data?.nodeId ?? n.type ?? ""));
    return def ? def.title[locale] : n.id;
  };

  // 1. Tiene que haber al menos un disparador (engine "trigger").
  const triggers = nodes.filter((n) => {
    const def = getNodeDef(String(n.data?.nodeId ?? n.type ?? ""));
    return (def?.engine ?? n.type) === "trigger";
  });
  if (nodes.length > 0 && triggers.length === 0) {
    issues.push({
      level: "error",
      message: "El flujo no tiene un paso de inicio. Agregá un disparador para poder ejecutarlo.",
    });
  }

  // 2. Campos obligatorios sin completar.
  for (const n of nodes) {
    const def = getNodeDef(String(n.data?.nodeId ?? n.type ?? ""));
    if (!def) continue;
    const config = n.data?.config ?? {};
    for (const f of def.fields) {
      if (f.required && fieldVisible(f, config) && isEmpty(config[f.key])) {
        issues.push({
          level: "error",
          nodeId: n.id,
          message: `Al paso "${labelOf(n)}" le falta completar "${f.label}".`,
        });
      }
    }
  }

  // 3. Conexiones que apuntan a un paso inexistente.
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) {
      issues.push({ level: "error", message: "Hay una conexión rota entre pasos. Borrala y rehacéla." });
    }
  }

  // 4. Pasos sueltos (sin conexión entrante ni saliente), salvo disparadores.
  const connected = new Set<string>();
  for (const e of edges) {
    connected.add(e.source);
    connected.add(e.target);
  }
  for (const n of nodes) {
    const def = getNodeDef(String(n.data?.nodeId ?? n.type ?? ""));
    const isTrigger = (def?.engine ?? n.type) === "trigger";
    const isNote = (def?.engine ?? n.type) === "note";
    if (!isTrigger && !isNote && nodes.length > 1 && !connected.has(n.id)) {
      issues.push({
        level: "warning",
        nodeId: n.id,
        message: `El paso "${labelOf(n)}" no está conectado a nada. Conectalo o borralo.`,
      });
    }
  }

  return issues;
}
