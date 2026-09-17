import { nrqlEscape, htmlEscape } from "@/lib/text/escape";

/**
 * `{{ path | filter:arg:arg }}` — pure, deterministic value derivation for
 * flow templates, so integration flows do not need `code` steps.
 */

export class FilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilterError";
  }
}

interface FilterSpec {
  /** [min, max] number of arguments. */
  arity: [number, number];
  apply: (value: unknown, args: string[]) => unknown;
}

function toEpoch(value: unknown, filter: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    if (/^-?\d+$/.test(value.trim())) return Number(value.trim());
    const t = Date.parse(value);
    if (!Number.isNaN(t)) return t;
  }
  throw new FilterError(`${filter}: "${String(value)}" is not a timestamp`);
}

function toInt(arg: string | undefined, filter: string): number {
  const n = Number(arg);
  if (arg === undefined || arg.trim() === "" || !Number.isInteger(n)) {
    throw new FilterError(`${filter}: "${arg ?? ""}" is not an integer`);
  }
  return n;
}

const asText = (value: unknown): string =>
  value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);

// Scheme words that precede a secret value ("Bearer <token>", "api_key=...").
// A word here can itself sit right after another scheme word (e.g. a message
// literally containing "token Bearer abc.def-123") — the negative lookahead
// below stops the regex from treating the second scheme word as if it were
// the secret value, which would leave the real value unmasked.
const SECRET_SCHEMES = "Bearer|Basic|token|api[_-]?key";

const REDACTIONS: Array<[RegExp, string]> = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]"],
  [
    new RegExp(`\\b(${SECRET_SCHEMES})\\b[:=]?\\s*(?!(?:${SECRET_SCHEMES})\\b)\\S{6,}`, "gi"),
    "$1 [secret]",
  ],
  [/\d{8,}/g, "[number]"],
];

const FILTERS: Record<string, FilterSpec> = {
  addMinutes: {
    arity: [1, 1],
    apply: (v, [n]) => toEpoch(v, "addMinutes") + toInt(n, "addMinutes") * 60_000,
  },
  toEpochMs: { arity: [0, 0], apply: (v) => toEpoch(v, "toEpochMs") },
  toIso: { arity: [0, 0], apply: (v) => new Date(toEpoch(v, "toIso")).toISOString() },
  slice: {
    arity: [1, 2],
    apply: (v, [s, e]) =>
      asText(v).slice(toInt(s, "slice"), e === undefined ? undefined : toInt(e, "slice")),
  },
  lower: { arity: [0, 0], apply: (v) => asText(v).toLowerCase() },
  upper: { arity: [0, 0], apply: (v) => asText(v).toUpperCase() },
  trim: { arity: [0, 0], apply: (v) => asText(v).trim() },
  // `default` takes the rest of the expression, colons included.
  default: {
    arity: [1, Infinity],
    apply: (v, args) => (v == null || v === "" ? args.join(":") : v),
  },
  json: { arity: [0, 0], apply: (v) => JSON.stringify(v ?? null) },
  nrql: { arity: [0, 0], apply: (v) => nrqlEscape(asText(v)) },
  html: { arity: [0, 0], apply: (v) => htmlEscape(asText(v)) },
  redact: {
    arity: [1, 1],
    apply: (v, [max]) => {
      const limit = toInt(max, "redact");
      let text = asText(v);
      for (const [re, repl] of REDACTIONS) text = text.replace(re, repl);
      return text.length > limit ? `${text.slice(0, limit)}…` : text;
    },
  },
};

export const FILTER_NAMES: readonly string[] = Object.keys(FILTERS);

interface ParsedFilter {
  name: string;
  args: string[];
}

function parse(expr: string): { path: string; filters: ParsedFilter[] } {
  const [path = "", ...rest] = expr.split("|").map((s) => s.trim());
  const filters = rest.map((part) => {
    const [name = "", ...args] = part.split(":");
    return { name: name.trim(), args };
  });
  return { path, filters };
}

function checkFilter(f: ParsedFilter): string | null {
  const spec = FILTERS[f.name];
  if (!spec) return `unknown filter "${f.name}"`;
  const [min, max] = spec.arity;
  if (f.args.length < min || f.args.length > max) {
    return `filter "${f.name}" takes ${min === max ? min : `${min}+`} argument(s), got ${f.args.length}`;
  }
  return null;
}

function walk(path: string, ctx: Record<string, unknown>): unknown {
  let v: unknown = ctx;
  for (const p of path.split(".")) {
    if (v && typeof v === "object" && p in (v as Record<string, unknown>)) {
      v = (v as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return v;
}

export function evaluateExpression(expr: string, ctx: Record<string, unknown>): unknown {
  const { path, filters } = parse(expr);
  let value = walk(path, ctx);
  for (const f of filters) {
    const problem = checkFilter(f);
    if (problem) throw new FilterError(problem);
    value = FILTERS[f.name]!.apply(value, f.args);
  }
  return value;
}

export function findTemplateErrors(template: string): string[] {
  const errors: string[] = [];
  for (const m of template.matchAll(/\{\{([^}]+)\}\}/g)) {
    for (const f of parse(m[1]!).filters) {
      const problem = checkFilter(f);
      if (problem) errors.push(`{{${m[1]!.trim()}}}: ${problem}`);
    }
  }
  return errors;
}
