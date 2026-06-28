import "server-only";

// ---------------------------------------------------------------------------
// Pure runtime helpers extracted from flow-engine.ts.
// Consumers: handler modules under ./handlers/
// ---------------------------------------------------------------------------

export function interpolate(template: string, ctx: Record<string, unknown>): string {
  if (typeof template !== "string") return "";
  return template.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
    const parts = path.trim().split(".");
    let v: unknown = ctx;
    for (const p of parts) {
      if (v && typeof v === "object" && p in (v as Record<string, unknown>)) {
        v = (v as Record<string, unknown>)[p];
      } else {
        return "";
      }
    }
    return v == null ? "" : String(v);
  });
}

export function resolveValue(template: unknown, ctx: Record<string, unknown>): unknown {
  if (typeof template !== "string") return template;
  const m = /^\s*\{\{([^}]+)\}\}\s*$/.exec(template);
  if (m) {
    const parts = m[1]!.trim().split(".");
    let v: unknown = ctx;
    for (const p of parts) {
      if (v && typeof v === "object" && p in (v as Record<string, unknown>)) {
        v = (v as Record<string, unknown>)[p];
      } else {
        return undefined;
      }
    }
    return v;
  }
  return interpolate(template, ctx);
}

export function deepInterpolate(value: unknown, ctx: Record<string, unknown>): unknown {
  if (typeof value === "string") return resolveValue(value, ctx);
  if (Array.isArray(value)) return value.map((v) => deepInterpolate(v, ctx));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepInterpolate(v, ctx);
    }
    return out;
  }
  return value;
}

export function parseDuration(input: unknown): number {
  if (typeof input === "number") return input;
  const s = String(input ?? "").trim();
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/.exec(s);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2] ?? "ms";
  const mult: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * (mult[unit] ?? 1);
}

export interface Condition {
  left: string;
  op: "==" | "!=" | ">" | "<" | ">=" | "<=" | "contains";
  right: string;
}

export function evaluateCondition(c: Condition, ctx: Record<string, unknown>): boolean {
  const l = interpolate(c.left, ctx);
  const r = interpolate(c.right, ctx);
  switch (c.op) {
    case "==":
      return l === r;
    case "!=":
      return l !== r;
    case "contains":
      return l.includes(r);
    case ">":
      return Number(l) > Number(r);
    case "<":
      return Number(l) < Number(r);
    case ">=":
      return Number(l) >= Number(r);
    case "<=":
      return Number(l) <= Number(r);
  }
}

export const FLOW_MAX_FANOUT = (() => {
  const raw = Number(process.env.FLOW_MAX_FANOUT ?? 10);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 10;
})();

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const effectiveLimit = Math.max(1, Math.min(limit, items.length || 1));
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i]!, i);
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: effectiveLimit }, () => worker()));
  return results;
}

const CODE_EXECUTION_ENABLED = process.env.FLOW_CODE_EXECUTION === "1";

export function assertCodeExecutionAllowed(kind: "código JavaScript" | "fórmulas"): void {
  if (!CODE_EXECUTION_ENABLED) {
    throw new Error(
      `La ejecución de ${kind} está deshabilitada en este entorno por seguridad. ` +
        `Un administrador debe habilitar FLOW_CODE_EXECUTION=1, y sólo en un entorno ` +
        `con aislamiento de procesos (sin secretos en el environment).`
    );
  }
}

export async function runUserJs(
  code: string,
  variables: Record<string, unknown>
): Promise<unknown> {
  assertCodeExecutionAllowed("código JavaScript");
  const vm = await import("node:vm");
  const input = structuredClone(variables);
  const sandbox = Object.create(null) as Record<string, unknown>;
  sandbox.__input__ = input;
  const context = vm.createContext(sandbox);
  const script = new vm.Script(`(function(input){"use strict";\n${code}\n})(__input__)`);
  try {
    return script.runInContext(context, { timeout: 1000 });
  } catch (e) {
    throw new Error(`El código falló al ejecutarse: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function runFormula(
  formula: string,
  variables: Record<string, unknown>
): Promise<unknown> {
  assertCodeExecutionAllowed("fórmulas");
  const vm = await import("node:vm");
  const formulajs = await import("@formulajs/formulajs");
  const expr = formula.startsWith("=") ? formula.slice(1) : formula;
  const input = structuredClone(variables);
  const sandbox: Record<string, unknown> = { ...formulajs, input };
  const context = vm.createContext(sandbox);
  try {
    return vm.runInContext(`(${expr})`, context, { timeout: 1000 });
  } catch (e) {
    throw new Error(`La fórmula tiene un error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function runUserCode(
  source: string,
  ctx: { variables: Record<string, unknown> }
): Promise<Record<string, unknown>> {
  const lines = source
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("#"));
  const out: Record<string, unknown> = {};
  for (const line of lines) {
    const m = /^set\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/.exec(line);
    if (!m) throw new Error(`Code node: unsupported syntax: ${line}`);
    const varName = m[1]!;
    const expr = interpolate(m[2]!, ctx.variables);
    let value: unknown = expr;
    try {
      value = JSON.parse(expr);
    } catch {}
    out[varName] = value;
    ctx.variables[varName] = value;
  }
  return out;
}
