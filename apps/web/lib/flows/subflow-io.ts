import { evaluateExpression, findTemplateErrors } from "./filters";

/**
 * Explicit input/output mapping of the `subflow` node.
 *
 * - `inputs`: child variable name -> expression evaluated in the PARENT's variables.
 * - `outputs`: parent variable name -> expression evaluated against the CHILD's final variables.
 *
 * Both are optional. Without them the node keeps its original behaviour (the child sees the
 * whole parent bag and the child's variables are merged back).
 */

export const SUBFLOW_IO_MAX_ENTRIES = 30;
export const SUBFLOW_IO_MAX_EXPR = 500;
/** Same rule as the `set name = ...` lines of the spreadsheet step. */
export const VARIABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Problems with one mapping, in the flow validator's language (Spanish). */
export function subflowMapProblems(field: "inputs" | "outputs", value: unknown): string[] {
  // Only an absent key (undefined) means "no mapping". null, arrays and strings are mistakes.
  if (value === undefined) return [];
  if (!isRecord(value)) return [`"${field}" tiene que ser un objeto nombre → expresión.`];
  const problems: string[] = [];
  const entries = Object.entries(value);
  if (entries.length > SUBFLOW_IO_MAX_ENTRIES) {
    problems.push(
      `"${field}" admite hasta ${SUBFLOW_IO_MAX_ENTRIES} entradas (tiene ${entries.length}).`
    );
  }
  for (const [name, expr] of entries) {
    if (!VARIABLE_NAME.test(name) || PROTO_KEYS.has(name)) {
      problems.push(
        `"${field}": "${name}" no es un nombre de variable válido (letras, números y _, sin empezar con número).`
      );
    }
    if (typeof expr !== "string" || expr.trim() === "") {
      problems.push(`"${field}": la expresión de "${name}" tiene que ser un texto no vacío.`);
    } else if (expr.length > SUBFLOW_IO_MAX_EXPR) {
      problems.push(
        `"${field}": la expresión de "${name}" supera los ${SUBFLOW_IO_MAX_EXPR} caracteres.`
      );
    } else if (field === "outputs" && !expr.includes("{{")) {
      // A bare path has no braces for the generic template check to look at.
      for (const p of findTemplateErrors(`{{${expr}}}`)) {
        problems.push(`"${field}": "${name}": ${p}`);
      }
    }
  }
  return problems;
}

/**
 * The mapping of a subflow node at execution time. `undefined` (key absent) keeps the legacy
 * behaviour; a PRESENT key must be a valid object (`null`, `[]` or `"{}"` throw), otherwise a
 * typo would silently hand the child the whole parent bag. An explicit `{}` is valid: the child
 * gets nothing (inputs) or nothing comes back (outputs).
 */
export function readSubflowMap(
  field: "inputs" | "outputs",
  value: unknown
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  const problems = subflowMapProblems(field, value);
  if (problems.length > 0) throw new Error(`subflow: ${problems.join(" ")}`);
  return value as Record<string, string>;
}

type Resolve = (template: unknown, ctx: Record<string, unknown>) => unknown;

/** Builds the child's input from `inputs`, evaluated in the parent's variables. */
export function buildSubflowInput(
  inputs: Record<string, string>,
  parentVars: Record<string, unknown>,
  resolveValue: Resolve
): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [name, expr] of Object.entries(inputs)) {
    let v: unknown;
    try {
      v = resolveValue(expr, parentVars);
    } catch (e) {
      throw new Error(`subflow: input "${name}": ${e instanceof Error ? e.message : String(e)}`);
    }
    // A path that does not resolve leaves the variable unset in the child.
    if (v !== undefined) out[name] = v;
  }
  return { ...out };
}

export interface SubflowOutputResult {
  values: Record<string, unknown>;
  /** Parent variables whose expression resolved to undefined; they are left untouched. */
  missing: string[];
}

/**
 * Evaluates `outputs` against the child's final variables. A bare path (`result.total`,
 * `name | upper`) or a `{{template}}` both work.
 */
export function readSubflowOutputs(
  outputs: Record<string, string>,
  childVars: Record<string, unknown>,
  resolveValue: Resolve
): SubflowOutputResult {
  const values: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const [name, expr] of Object.entries(outputs)) {
    let v: unknown;
    try {
      v = expr.includes("{{")
        ? resolveValue(expr, childVars)
        : evaluateExpression(expr.trim(), childVars);
    } catch (e) {
      throw new Error(`subflow: output "${name}": ${e instanceof Error ? e.message : String(e)}`);
    }
    // Only undefined is "missing": an explicit null is a real value and overwrites the parent.
    if (v === undefined) missing.push(name);
    else values[name] = v;
  }
  return { values, missing };
}
