# Flow Management over MCP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an MCP client with a workspace API key build, validate, document and debug flows, and give flows the engine primitives (retry, interpolation filters, `done` handle) that integration flows need without `code` steps.

**Architecture:** Pure, client-safe modules for filters, retry and stored-flow validation under `apps/web/lib/flows/`; small, opt-in changes to `lib/flow-engine.ts`; a server-only flow service (`lib/flows/service.ts`) that both the session routes and the new MCP tools (`lib/mcp/flow-tools.ts`) call; two nullable `spec` columns; editor support for the spec and per-step purpose.

**Tech Stack:** Next.js 15 route handlers, TypeScript, Drizzle ORM (Postgres), Vitest (jsdom), React + @xyflow/react, next-intl, pnpm workspaces.

**Spec:** `docs/specs/2026-09-17-mcp-flow-management-design.md`

## Global Constraints

- Public repository: no secrets, no real hostnames, emails, account ids or tenant names in code, tests, fixtures or docs. Test values are visibly fake (`ok_live_test`, `ws_test`, `https://example.com`).
- Conventional Commits with lowercase subjects; every commit signed off: `git commit -s`. Never `--no-verify`.
- Code, comments and docs in English. User-facing flow validation messages follow the existing Spanish messages in `lib/flows/validate.ts`; editor strings go through `messages/{es,en,pt}.json`.
- Before the PR: `pnpm --filter web exec tsc --noEmit`, `pnpm --filter web test`, `pnpm --filter web lint:tenant` and `bash scripts/audit-invariants.sh` all pass.
- Every new engine behaviour is opt-in per step: a flow stored before this change runs exactly as before.
- `purpose` is at most 280 characters, one line. `retry.attempts` is 1–5. `list_flow_runs.limit` defaults to 20, max 100.
- Write MCP tools accept keys that are unscoped, or hold `write` or `flows:write`; `readonly` always refuses.
- Workspace-scoped DB access in new code goes through `withWorkspaceTx` (`lib/tenant/context.ts`), which runs `SET LOCAL ROLE app_user` and sets `app.workspace_id`.

## File map

| File | Status | Responsibility |
|---|---|---|
| `apps/web/lib/text/escape.ts` | create | Client-safe `nrqlEscape`, `htmlFromText`, `htmlEscape` |
| `apps/web/lib/integrations/newrelic-client.ts` | modify | Re-export `nrqlEscape` from `lib/text/escape` |
| `apps/web/lib/integrations/odoo-client.ts` | modify | Re-export `htmlFromText` from `lib/text/escape` |
| `apps/web/lib/flows/filters.ts` | create | Parse and apply `{{ path \| filter:arg }}` expressions; validate templates |
| `apps/web/lib/flows/retry.ts` | create | Retry config parsing, backoff, retry loop, `StepFailure` |
| `apps/web/lib/flow-engine.ts` | modify | Use filters in interpolation; retry in `integration`/`http`; `failOnStatus`; attempts on failed steps; `done` handle in `try_catch`/`parallel` |
| `apps/web/components/flows/nodes/BranchNode.tsx` | modify | `done` handle on try/catch; new `ParallelNode` |
| `apps/web/components/flows/FlowBuilder.tsx` | modify | Register `ParallelNode`; carry `purpose`; Documentation panel; pass spec to validation |
| `apps/web/components/flows/FlowDocsPanel.tsx` | create | Spec editor with template and preview |
| `apps/web/components/flows/inspector/InspectorForm.tsx` | modify | Purpose field |
| `apps/web/messages/{es,en,pt}.json` | modify | New editor strings |
| `packages/db/src/schema/flows.ts` | modify | `spec` on `flow` and `flow_version` |
| `packages/db/migrations/0055_flow_spec.sql` | create | Add the two columns |
| `packages/db/scripts/apply-sql-migrations.mjs` | modify | Manifest entry for 0055 |
| `apps/web/lib/flows/normalize.ts` | modify | Keep `purpose`; export `registryIdOf` |
| `apps/web/lib/flows/versions.ts` | create | Pure snapshot/restore helpers carrying `spec` |
| `apps/web/app/api/flows/[id]/versions/route.ts`, `.../[vid]/restore/route.ts` | modify | Use the helpers |
| `apps/web/lib/flows/validate.ts` | modify | Optional docs warnings |
| `apps/web/lib/flows/validate-stored.ts` | create | `validateStoredFlow` adapter |
| `apps/web/lib/audit/log.ts` | modify | `appendAuditInTx` |
| `apps/web/lib/flows/service.ts` | create | Workspace-scoped flow operations for routes and MCP |
| `apps/web/app/api/flows/route.ts`, `[id]/route.ts`, `[id]/webhooks/route.ts`, `app/api/flow-runs/[id]/route.ts` | modify | Thin handlers over the service |
| `apps/web/lib/mcp/flow-tools.ts` | create | The eight flow MCP tools |
| `apps/web/lib/mcp/server.ts` | modify | Export tool type, scope check, register flow tools, fix `list_flows`, update `run_flow` text |

Tests live next to the module (`*.test.ts`) for pure code, and in `apps/web/__tests__/` for code that needs the DB mock.

---

### Task 1: Workspace setup and baseline

**Files:** none changed.

- [ ] **Step 1: Install dependencies in the worktree**

Run: `cd /Users/pablomojeda/work/orchester-mcpflows && pnpm install --frozen-lockfile`
Expected: completes without errors.

- [ ] **Step 2: Record the baseline**

Run:
```bash
cd apps/web
pnpm exec tsc --noEmit 2>&1 | tail -5
pnpm test 2>&1 | tail -15
```
Expected: note the exact pass/fail counts in the task report. Integration suites that need Docker may fail or skip; list them. Every later task compares against this baseline, not against zero.

- [ ] **Step 3: Check gitleaks is installed**

Run: `which gitleaks || brew install gitleaks`
Expected: a path is printed.

No commit.

---

### Task 2: Client-safe escaping helpers

**Files:**
- Create: `apps/web/lib/text/escape.ts`
- Create: `apps/web/lib/text/escape.test.ts`
- Modify: `apps/web/lib/integrations/newrelic-client.ts:28-34`
- Modify: `apps/web/lib/integrations/odoo-client.ts:47-58`

**Interfaces:**
- Produces: `nrqlEscape(value: string): string`, `htmlFromText(text: string): string`, `htmlEscape(text: string): string` from `@/lib/text/escape`. `newrelic-client` and `odoo-client` keep exporting the same names.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/text/escape.test.ts
import { describe, it, expect } from "vitest";
import { nrqlEscape, htmlFromText, htmlEscape } from "./escape";

describe("nrqlEscape", () => {
  it("escapes backslashes and single quotes without adding quotes", () => {
    expect(nrqlEscape(`it's a\\b`)).toBe(`it\\'s a\\\\b`);
  });
});

describe("htmlFromText", () => {
  it("escapes angle brackets and ampersands and keeps line breaks", () => {
    expect(htmlFromText("a < b & c\nd")).toBe("a &lt; b &amp; c<br/>d");
  });
});

describe("htmlEscape", () => {
  it("also escapes quotes", () => {
    expect(htmlEscape(`<a href="x">it's</a>\n`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;it&#39;s&lt;/a&gt;<br/>"
    );
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd apps/web && pnpm exec vitest run lib/text/escape.test.ts`
Expected: FAIL, cannot resolve `./escape`.

- [ ] **Step 3: Implement**

```ts
// apps/web/lib/text/escape.ts
/**
 * Escaping helpers with no server dependencies, so flow validation can use
 * them in the browser as well as in the engine.
 */

/**
 * Escapes a value for embedding inside single quotes in NRQL. NRQL escapes with
 * a backslash, same as SQL string literals in most dialects. The caller writes
 * the quotes.
 */
export function nrqlEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Odoo renders `description` and chatter bodies as HTML. Markdown reaches the
 * ticket as literal asterisks, and an unescaped `<` truncates the report at
 * the first angle bracket — which, in a stack trace, is common.
 */
export function htmlFromText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r\n|\r|\n/g, "<br/>");
}

/** `htmlFromText` plus quotes, safe inside attribute values too. */
export function htmlEscape(text: string): string {
  return htmlFromText(text).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
```

In `newrelic-client.ts`, delete the local `nrqlEscape` function and its comment, and add below the imports:
```ts
import { nrqlEscape } from "@/lib/text/escape";
export { nrqlEscape };
```
In `odoo-client.ts`, delete the local `htmlFromText` function and its comment, and add below the imports:
```ts
import { htmlFromText } from "@/lib/text/escape";
export { htmlFromText };
```

- [ ] **Step 4: Run the new test and the connector suites**

Run: `pnpm exec vitest run lib/text/escape.test.ts __tests__/newrelic-connector.test.ts __tests__/odoo-connector.test.ts __tests__/newrelic-agent-tools.test.ts __tests__/odoo-agent-tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/text apps/web/lib/integrations/newrelic-client.ts apps/web/lib/integrations/odoo-client.ts
git diff --cached
git commit -s -m "refactor(text): move nrql and html escaping to a client-safe module"
```

---

### Task 3: Interpolation filters

**Files:**
- Create: `apps/web/lib/flows/filters.ts`
- Create: `apps/web/lib/flows/filters.test.ts`
- Modify: `apps/web/lib/flow-engine.ts:141-182` (`interpolate`, `resolveValue`)
- Modify: `apps/web/__tests__/flow-engine.test.ts` (append cases)

**Interfaces:**
- Consumes: `nrqlEscape`, `htmlEscape` from `@/lib/text/escape`.
- Produces (from `@/lib/flows/filters`):
  - `class FilterError extends Error`
  - `FILTER_NAMES: readonly string[]`
  - `evaluateExpression(expr: string, ctx: Record<string, unknown>): unknown` — walks the path, applies filters; returns `undefined` for a missing path with no filter that supplies a value; throws `FilterError` for an unknown filter or a bad argument.
  - `findTemplateErrors(template: string): string[]` — one message per unknown filter or bad argument count inside any `{{…}}`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/flows/filters.test.ts
import { describe, it, expect } from "vitest";
import { evaluateExpression, findTemplateErrors, FilterError } from "./filters";

const ctx = {
  issueId: "a1b2c3d4e5f6",
  at: 1_700_000_000_000,
  iso: "2023-11-14T22:13:20.000Z",
  name: "  Mixed Case  ",
  app: "user's-service",
  obj: { a: [1, 2] },
  empty: "",
  msg: "mail john.doe@example.com token Bearer abc.def-123 jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig id 123456789",
};

describe("evaluateExpression", () => {
  it("returns the raw value without filters", () => {
    expect(evaluateExpression("obj.a", ctx)).toEqual([1, 2]);
    expect(evaluateExpression("missing.path", ctx)).toBeUndefined();
  });
  it("addMinutes shifts epoch ms and ISO input", () => {
    expect(evaluateExpression("at | addMinutes:-15", ctx)).toBe(1_700_000_000_000 - 900_000);
    expect(evaluateExpression("iso | addMinutes:5", ctx)).toBe(1_700_000_000_000 + 300_000);
  });
  it("toIso and toEpochMs convert", () => {
    expect(evaluateExpression("at | toIso", ctx)).toBe("2023-11-14T22:13:20.000Z");
    expect(evaluateExpression("iso | toEpochMs", ctx)).toBe(1_700_000_000_000);
  });
  it("chains left to right", () => {
    expect(evaluateExpression("at | addMinutes:-1440 | toIso", ctx)).toBe(
      "2023-11-13T22:13:20.000Z"
    );
  });
  it("slice, lower, upper, trim", () => {
    expect(evaluateExpression("issueId | slice:0:8", ctx)).toBe("a1b2c3d4");
    expect(evaluateExpression("name | trim | lower", ctx)).toBe("mixed case");
    expect(evaluateExpression("name | trim | upper", ctx)).toBe("MIXED CASE");
  });
  it("default covers missing and empty values, and keeps colons", () => {
    expect(evaluateExpression("missing | default:unknown", ctx)).toBe("unknown");
    expect(evaluateExpression("empty | default:a:b", ctx)).toBe("a:b");
    expect(evaluateExpression("issueId | default:x", ctx)).toBe("a1b2c3d4e5f6");
  });
  it("json, nrql, html", () => {
    expect(evaluateExpression("obj | json", ctx)).toBe('{"a":[1,2]}');
    expect(evaluateExpression("app | nrql", ctx)).toBe("user\\'s-service");
    expect(evaluateExpression("app | html", ctx)).toBe("user&#39;s-service");
  });
  it("redact masks emails, bearer tokens, JWTs and long digit runs, then truncates", () => {
    const out = String(evaluateExpression("msg | redact:500", ctx));
    expect(out).not.toContain("john.doe@example.com");
    expect(out).not.toContain("abc.def-123");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(out).not.toContain("123456789");
    expect(out).toContain("[email]");
    expect(String(evaluateExpression("msg | redact:10", ctx)).length).toBeLessThanOrEqual(11);
  });
  it("throws on unknown filters and bad arguments", () => {
    expect(() => evaluateExpression("at | nope", ctx)).toThrow(FilterError);
    expect(() => evaluateExpression("at | addMinutes:abc", ctx)).toThrow(FilterError);
    expect(() => evaluateExpression("name | addMinutes:5", ctx)).toThrow(FilterError);
  });
});

describe("findTemplateErrors", () => {
  it("reports unknown filters and wrong argument counts", () => {
    expect(findTemplateErrors("x {{a | nope}} {{b | slice}}")).toHaveLength(2);
  });
  it("accepts valid templates and plain text", () => {
    expect(findTemplateErrors("SINCE {{at | addMinutes:-15}} {{plain}} no braces")).toEqual([]);
  });
});
```

Append to `apps/web/__tests__/flow-engine.test.ts`:
```ts
describe("interpolation filters in the engine", () => {
  it("interpolate applies filters", () => {
    expect(interpolate("NR-{{id | slice:0:4}}", { id: "abcdefgh" })).toBe("NR-abcd");
  });
  it("resolveValue keeps the filtered value's type", () => {
    expect(resolveValue("{{at | addMinutes:1}}", { at: 0 })).toBe(60_000);
  });
  it("templates without filters behave exactly as before", () => {
    expect(interpolate("{{user.email}}", { user: { email: "x@y" } })).toBe("x@y");
    expect(interpolate("Hello {{missing}}", {})).toBe("Hello ");
    expect(resolveValue("{{missing}}", {})).toBeUndefined();
    expect(interpolate("{{o}}", { o: { a: 1 } })).toBe('{"a":1}');
  });
});
```

- [ ] **Step 2: Run and see them fail**

Run: `pnpm exec vitest run lib/flows/filters.test.ts __tests__/flow-engine.test.ts`
Expected: FAIL — `./filters` missing; filter cases in the engine produce empty strings.

- [ ] **Step 3: Implement the filters**

```ts
// apps/web/lib/flows/filters.ts
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

const REDACTIONS: Array<[RegExp, string]> = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]"],
  [/\b(Bearer|Basic|token|api[_-]?key)\s*[:=]?\s*[A-Za-z0-9._~+/=-]{6,}/gi, "$1 [secret]"],
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
```

- [ ] **Step 4: Use it in the engine**

In `apps/web/lib/flow-engine.ts` add `import { evaluateExpression } from "./flows/filters";` with the other imports, and replace the bodies of `interpolate` and `resolveValue`:

```ts
export function interpolate(template: string, ctx: Record<string, unknown>): string {
  if (typeof template !== "string") return "";
  return template.replace(/\{\{([^}]+)\}\}/g, (_, expr: string) => {
    const v = evaluateExpression(expr.trim(), ctx);
    if (v == null) return "";
    // Objects and arrays as JSON: an http step parses JSON responses and
    // kb_search leaves an array of results, and String() turned both into the
    // literal "[object Object]" inside prompts and request bodies.
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  });
}

export function resolveValue(template: unknown, ctx: Record<string, unknown>): unknown {
  if (typeof template !== "string") return template;
  const m = /^\s*\{\{([^}]+)\}\}\s*$/.exec(template);
  if (m) return evaluateExpression(m[1]!.trim(), ctx);
  return interpolate(template, ctx);
}
```
Keep the existing doc comment above `resolveValue`.

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run lib/flows/filters.test.ts __tests__/flow-engine.test.ts lib/flows/interpolate.test.ts`
Expected: PASS. If a redact assertion fails, adjust the regex in `REDACTIONS`, not the test.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/flows/filters.ts apps/web/lib/flows/filters.test.ts apps/web/lib/flow-engine.ts apps/web/__tests__/flow-engine.test.ts
git diff --cached
git commit -s -m "feat(flows): add interpolation filters for deriving values without code steps"
```

---

### Task 4: Retry on integration and http steps

**Files:**
- Create: `apps/web/lib/flows/retry.ts`
- Create: `apps/web/lib/flows/retry.test.ts`
- Modify: `apps/web/lib/flow-engine.ts` — `runFromNode` catch block (~line 596), `http` handler (~lines 775-803), `integration` handler (~lines 1019-1030)
- Create: `apps/web/__tests__/flow-engine-harness.ts`
- Create: `apps/web/__tests__/flow-engine-retry.test.ts`

**Interfaces:**
- Produces (from `@/lib/flows/retry`):
  ```ts
  export interface RetryConfig { attempts: number; backoffMs: number; maxBackoffMs: number }
  export interface AttemptRecord { attempt: number; ok: boolean; status?: number; error?: string; delayMs?: number }
  export type AttemptOutcome<T> =
    | { kind: "done"; value: T; status?: number }
    | { kind: "retry"; error: Error; status?: number; value?: T };
  export interface RetryDeps { sleep: (ms: number) => Promise<void>; random: () => number }
  export function parseRetryConfig(raw: unknown): RetryConfig | null
  export function backoffDelay(cfg: RetryConfig, attempt: number, random: () => number): number
  export function runWithRetry<T>(cfg: RetryConfig, attemptFn: (attempt: number) => Promise<AttemptOutcome<T>>, deps?: Partial<RetryDeps>):
    Promise<{ ok: true; value: T; status?: number; attempts: AttemptRecord[] } |
            { ok: false; error: Error; status?: number; value?: T; attempts: AttemptRecord[] }>
  export class StepFailure extends Error { readonly output: Record<string, unknown> }
  ```
- Produces (from `apps/web/__tests__/flow-engine-harness.ts`): `runFlowGraph(nodes, edges, input?)` returning `{ status, error, steps, output }`, used by Tasks 4 and 5.

- [ ] **Step 1: Write the failing unit tests**

```ts
// apps/web/lib/flows/retry.test.ts
import { describe, it, expect, vi } from "vitest";
import { parseRetryConfig, backoffDelay, runWithRetry, StepFailure } from "./retry";

const noSleep = { sleep: vi.fn(async () => {}), random: () => 1 };

describe("parseRetryConfig", () => {
  it("returns null when absent or malformed", () => {
    expect(parseRetryConfig(undefined)).toBeNull();
    expect(parseRetryConfig("x")).toBeNull();
  });
  it("clamps attempts to 1..5 and fills defaults", () => {
    expect(parseRetryConfig({ attempts: 9 })).toEqual({ attempts: 5, backoffMs: 1000, maxBackoffMs: 30000 });
    expect(parseRetryConfig({ attempts: 0, backoffMs: 10, maxBackoffMs: 20 })).toEqual({ attempts: 1, backoffMs: 10, maxBackoffMs: 20 });
  });
});

describe("backoffDelay", () => {
  const cfg = { attempts: 5, backoffMs: 1000, maxBackoffMs: 3000 };
  it("doubles and caps, with jitter between 50% and 100%", () => {
    expect(backoffDelay(cfg, 1, () => 1)).toBe(1000);
    expect(backoffDelay(cfg, 2, () => 1)).toBe(2000);
    expect(backoffDelay(cfg, 3, () => 1)).toBe(3000);
    expect(backoffDelay(cfg, 3, () => 0)).toBe(1500);
  });
});

describe("runWithRetry", () => {
  const cfg = { attempts: 3, backoffMs: 100, maxBackoffMs: 1000 };
  it("stops at the first done outcome", async () => {
    const fn = vi.fn(async () => ({ kind: "done" as const, value: 7 }));
    const r = await runWithRetry(cfg, fn, noSleep);
    expect(r).toMatchObject({ ok: true, value: 7 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(r.attempts).toEqual([{ attempt: 1, ok: true }]);
  });
  it("retries until the budget runs out and records every attempt", async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async () => ({ kind: "retry" as const, error: new Error("boom"), status: 503 }));
    const r = await runWithRetry(cfg, fn, { sleep, random: () => 1 });
    expect(r.ok).toBe(false);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 200]);
    expect(r.attempts).toEqual([
      { attempt: 1, ok: false, status: 503, error: "boom", delayMs: 100 },
      { attempt: 2, ok: false, status: 503, error: "boom", delayMs: 200 },
      { attempt: 3, ok: false, status: 503, error: "boom" },
    ]);
  });
  it("succeeds on a later attempt", async () => {
    let n = 0;
    const r = await runWithRetry(cfg, async () =>
      ++n < 2 ? { kind: "retry", error: new Error("x") } : { kind: "done", value: "ok" }, noSleep);
    expect(r).toMatchObject({ ok: true, value: "ok" });
    expect(r.attempts).toHaveLength(2);
  });
});

describe("StepFailure", () => {
  it("carries the step output", () => {
    const e = new StepFailure("failed", { attempts: [] });
    expect(e).toBeInstanceOf(Error);
    expect(e.output).toEqual({ attempts: [] });
  });
});
```

- [ ] **Step 2: Run and see them fail**

Run: `pnpm exec vitest run lib/flows/retry.test.ts`
Expected: FAIL, cannot resolve `./retry`.

- [ ] **Step 3: Implement `retry.ts`**

```ts
// apps/web/lib/flows/retry.ts
/**
 * Opt-in retry for steps that call external systems. Retries repeat the
 * external call, so the flow author is responsible for idempotency.
 */

export interface RetryConfig {
  attempts: number;
  backoffMs: number;
  maxBackoffMs: number;
}

export interface AttemptRecord {
  attempt: number;
  ok: boolean;
  status?: number;
  error?: string;
  delayMs?: number;
}

export type AttemptOutcome<T> =
  | { kind: "done"; value: T; status?: number }
  | { kind: "retry"; error: Error; status?: number; value?: T };

export interface RetryDeps {
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

const DEFAULT_DEPS: RetryDeps = {
  sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
  random: Math.random,
};

function int(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function parseRetryConfig(raw: unknown): RetryConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  return {
    attempts: int(r.attempts, 1, 1, 5),
    backoffMs: int(r.backoffMs, 1000, 0, 60_000),
    maxBackoffMs: int(r.maxBackoffMs, 30_000, 0, 300_000),
  };
}

/** Delay before retrying after `attempt` failed: doubling, capped, 50–100% jitter. */
export function backoffDelay(cfg: RetryConfig, attempt: number, random: () => number): number {
  const base = Math.min(cfg.maxBackoffMs, cfg.backoffMs * 2 ** (attempt - 1));
  return Math.round(base * (0.5 + random() / 2));
}

export async function runWithRetry<T>(
  cfg: RetryConfig,
  attemptFn: (attempt: number) => Promise<AttemptOutcome<T>>,
  deps: Partial<RetryDeps> = {}
): Promise<
  | { ok: true; value: T; status?: number; attempts: AttemptRecord[] }
  | { ok: false; error: Error; status?: number; value?: T; attempts: AttemptRecord[] }
> {
  const { sleep, random } = { ...DEFAULT_DEPS, ...deps };
  const attempts: AttemptRecord[] = [];
  for (let attempt = 1; ; attempt++) {
    const outcome = await attemptFn(attempt);
    if (outcome.kind === "done") {
      attempts.push({
        attempt,
        ok: true,
        ...(outcome.status !== undefined ? { status: outcome.status } : {}),
      });
      return {
        ok: true,
        value: outcome.value,
        ...(outcome.status !== undefined ? { status: outcome.status } : {}),
        attempts,
      };
    }
    const record: AttemptRecord = {
      attempt,
      ok: false,
      ...(outcome.status !== undefined ? { status: outcome.status } : {}),
      error: outcome.error.message,
    };
    attempts.push(record);
    if (attempt >= cfg.attempts) {
      return {
        ok: false,
        error: outcome.error,
        ...(outcome.status !== undefined ? { status: outcome.status } : {}),
        ...(outcome.value !== undefined ? { value: outcome.value } : {}),
        attempts,
      };
    }
    const delayMs = backoffDelay(cfg, attempt, random);
    record.delayMs = delayMs;
    await sleep(delayMs);
  }
}

/** A step failure that still has output worth recording (e.g. its attempts). */
export class StepFailure extends Error {
  readonly output: Record<string, unknown>;
  constructor(message: string, output: Record<string, unknown>) {
    super(message);
    this.name = "StepFailure";
    this.output = output;
  }
}
```

- [ ] **Step 4: Run the unit tests**

Run: `pnpm exec vitest run lib/flows/retry.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the engine harness and failing engine tests**

```ts
// apps/web/__tests__/flow-engine-harness.ts
//
// Drives executeFlow over an in-memory graph. The DB mock cannot read the id
// inside a drizzle `where(eq(...))`, so it attributes each status update by the
// engine's own ordering: a step's status update always targets the innermost
// step that is still open (a try_catch/parallel step closes after its
// children). When no step is open, the update belongs to the run.
import { vi } from "vitest";

export interface RecordedStep {
  id: string;
  nodeId: string;
  status?: string;
  output?: unknown;
  error?: string;
}

export const state = {
  flow: {
    id: "flow_test",
    workspaceId: "ws_test",
    nodes: [] as unknown[],
    edges: [] as unknown[],
    variables: {},
  },
  steps: [] as RecordedStep[],
  runUpdates: [] as Array<Record<string, unknown>>,
};

let idCounter = 0;
export function nextId(): string {
  idCounter += 1;
  return `id_${idCounter}`;
}

function applySet(set: Record<string, unknown>) {
  if ("lastRunAt" in set) return; // the flow row's lastRunAt bump
  const open = [...state.steps].reverse().find((s) => !s.status);
  if (open && "status" in set) {
    open.status = String(set.status);
    if ("output" in set) open.output = set.output;
    if ("error" in set) open.error = String(set.error);
    return;
  }
  if ("status" in set) state.runUpdates.push(set);
}

function makeTx() {
  let pendingSet: Record<string, unknown> | null = null;
  const tx: Record<string, unknown> = {
    execute: vi.fn(async () => ({ rows: [] })),
    select: () => tx,
    from: () => tx,
    where: () => {
      if (pendingSet) {
        applySet(pendingSet);
        pendingSet = null;
        return Promise.resolve([]);
      }
      return { limit: async () => [state.flow] };
    },
    insert: () => tx,
    values: async (row: Record<string, unknown>) => {
      if ("nodeId" in row) state.steps.push({ id: String(row.id), nodeId: String(row.nodeId) });
    },
    update: () => tx,
    set: (s: Record<string, unknown>) => {
      pendingSet = s;
      return tx;
    },
  };
  return tx;
}

export const dbMock = {
  getDb: vi.fn(() => ({
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx())),
  })),
  schema: {
    flows: { id: "flows.id", workspaceId: "flows.workspaceId" },
    flowRuns: { id: "flowRuns.id" },
    flowRunSteps: { id: "flowRunSteps.id" },
  },
};

export async function runFlowGraph(
  nodes: unknown[],
  edges: unknown[],
  input: Record<string, unknown> = {}
) {
  state.flow = { ...state.flow, nodes, edges };
  state.steps = [];
  state.runUpdates = [];
  const { executeFlow } = await import("../lib/flow-engine");
  const result = await executeFlow({
    flowId: "flow_test",
    workspaceId: "ws_test",
    triggerSource: "test",
    input,
  });
  const final = state.runUpdates.at(-1) ?? {};
  return {
    ...result,
    steps: state.steps,
    output: (final.output ?? {}) as Record<string, unknown>,
  };
}
```

`vi.mock` factories are hoisted above imports, so each test file mocks `@orchester/db` with a factory that imports the harness lazily: `vi.mock("@orchester/db", async () => (await import("./flow-engine-harness")).dbMock);`. Use that form in both engine test files instead of `vi.mock("@orchester/db", () => dbMock)`, and the same for `nextId` in the `@paralleldrive/cuid2` mock. Confirm the harness with the "harness sanity" test before relying on it.

```ts
// apps/web/__tests__/flow-engine-retry.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runFlowGraph } from "./flow-engine-harness";

vi.mock("@orchester/db", async () => (await import("./flow-engine-harness")).dbMock);
vi.mock("drizzle-orm", async () => vi.importActual("drizzle-orm"));
vi.mock("@/lib/queue", () => ({ enqueue: vi.fn(), JOB_FLOW_RUN: "flow.run" }));
vi.mock("@/lib/net-guard", () => ({ assertPublicUrl: vi.fn() }));
vi.mock("@/lib/observability", () => ({ recordMetric: vi.fn(), logWithContext: vi.fn() }));
vi.mock("@/lib/llm-call", () => ({ llmCall: vi.fn(), llmStream: vi.fn() }));
vi.mock("@paralleldrive/cuid2", async () => {
  const { nextId } = await import("./flow-engine-harness");
  return { createId: () => nextId() };
});

const runAction = vi.fn();
vi.mock("@/lib/integrations/store", () => ({ runIntegrationAction: (...a: unknown[]) => runAction(...a) }));

const trigger = { id: "t", type: "trigger", label: "t", config: { triggerKind: "manual" }, position: { x: 0, y: 0 } };
const step = (id: string, type: string, config: Record<string, unknown>) => ({ id, type, label: id, config, position: { x: 0, y: 0 } });
const edge = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${target}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) });

beforeEach(() => {
  runAction.mockReset();
  vi.stubGlobal("fetch", vi.fn());
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

describe("harness sanity", () => {
  it("records a transform step and the run output", async () => {
    const r = await runFlowGraph(
      [trigger, step("x", "transform", { template: { a: "1" } })],
      [edge("t", "x")]
    );
    expect(r.status).toBe("succeeded");
    expect(r.steps.map((s) => [s.nodeId, s.status])).toEqual([["t", "succeeded"], ["x", "succeeded"]]);
    expect(r.output).toMatchObject({ a: "1" });
  });
});

describe("integration retry", () => {
  it("without retry config, fails on the first error (unchanged)", async () => {
    runAction.mockRejectedValue(new Error("odoo down"));
    const r = await runFlowGraph([trigger, step("i", "integration", { integrationId: "odoo::execute", input: {} })], [edge("t", "i")]);
    expect(r.status).toBe("failed");
    expect(runAction).toHaveBeenCalledTimes(1);
  });
  it("retries and records attempts on the failed step", async () => {
    runAction.mockRejectedValue(new Error("odoo down"));
    const r = await runFlowGraph(
      [trigger, step("i", "integration", { integrationId: "odoo::execute", input: {}, retry: { attempts: 3, backoffMs: 1, maxBackoffMs: 1 } })],
      [edge("t", "i")]
    );
    expect(r.status).toBe("failed");
    expect(runAction).toHaveBeenCalledTimes(3);
    const failed = r.steps.find((s) => s.nodeId === "i")!;
    expect(failed.status).toBe("failed");
    expect((failed.output as { attempts: unknown[] }).attempts).toHaveLength(3);
  });
  it("succeeds after a transient error and records both attempts", async () => {
    runAction.mockRejectedValueOnce(new Error("blip")).mockResolvedValueOnce({ result: 42 });
    const r = await runFlowGraph(
      [trigger, step("i", "integration", { integrationId: "odoo::execute", input: {}, outputVar: "res", retry: { attempts: 2, backoffMs: 1, maxBackoffMs: 1 } })],
      [edge("t", "i")]
    );
    expect(r.status).toBe("succeeded");
    expect(r.output).toMatchObject({ res: { result: 42 } });
    expect((r.steps.find((s) => s.nodeId === "i")!.output as { attempts: unknown[] }).attempts).toHaveLength(2);
  });
});

const response = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }) as Response;

describe("http retry", () => {
  const url = "https://example.com/hook";
  it("legacy maxAttempts still retries a 400 when retry is absent", async () => {
    const f = vi.mocked(fetch);
    f.mockResolvedValueOnce(response(400, {})).mockResolvedValueOnce(response(200, { ok: 1 }));
    const r = await runFlowGraph([trigger, step("h", "http", { url, method: "GET", maxAttempts: 2 })], [edge("t", "h")]);
    expect(r.status).toBe("succeeded");
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("with retry, a 400 is not retried and returns as before", async () => {
    const f = vi.mocked(fetch);
    f.mockResolvedValue(response(400, { e: 1 }));
    const r = await runFlowGraph(
      [trigger, step("h", "http", { url, method: "GET", maxAttempts: 5, retry: { attempts: 3, backoffMs: 1, maxBackoffMs: 1 } })],
      [edge("t", "h")]
    );
    expect(r.status).toBe("succeeded");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("with retry, 503 is retried; failOnStatus fails the step at the end", async () => {
    const f = vi.mocked(fetch);
    f.mockResolvedValue(response(503, {}));
    const r = await runFlowGraph(
      [trigger, step("h", "http", { url, method: "GET", failOnStatus: true, retry: { attempts: 2, backoffMs: 1, maxBackoffMs: 1 } })],
      [edge("t", "h")]
    );
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.status).toBe("failed");
    expect((r.steps.find((s) => s.nodeId === "h")!.output as { attempts: unknown[] }).attempts).toHaveLength(2);
  });
  it("failOnStatus without retry fails a final 404", async () => {
    vi.mocked(fetch).mockResolvedValue(response(404, {}));
    const r = await runFlowGraph([trigger, step("h", "http", { url, method: "GET", failOnStatus: true })], [edge("t", "h")]);
    expect(r.status).toBe("failed");
  });
});
```

- [ ] **Step 6: Run and see the engine tests fail**

Run: `pnpm exec vitest run __tests__/flow-engine-retry.test.ts`
Expected: the harness sanity test PASSES (fix the harness until it does, without touching the engine); the retry tests FAIL (single call, no attempts recorded, `failOnStatus` ignored).

- [ ] **Step 7: Implement retry in the engine**

In `lib/flow-engine.ts` add `import { parseRetryConfig, runWithRetry, StepFailure } from "./flows/retry";`.

In `runFromNode`'s `catch (e)` block, record a `StepFailure`'s output:
```ts
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await withFlowTx(workspaceId, (tx) =>
      tx
        .update(schema.flowRunSteps)
        .set({
          status: "failed",
          error: msg,
          ...(e instanceof StepFailure ? { output: e.output } : {}),
          completedAt: new Date(),
        })
        .where(eq(schema.flowRunSteps.id, stepId))
    );
```

Replace the `integration` handler body after `const { runIntegrationAction } = …`:
```ts
    const retry = parseRetryConfig(cfg.retry);
    const outputVar = (cfg.outputVar as string) ?? "appResult";
    if (!retry) {
      const result = await runIntegrationAction(workspaceId, integrationId, action, input);
      ctx.variables[outputVar] = result;
      helpers.setOutput({ result });
      return;
    }
    const r = await runWithRetry(retry, async () => {
      try {
        return { kind: "done", value: await runIntegrationAction(workspaceId, integrationId, action, input) };
      } catch (e) {
        return { kind: "retry", error: e instanceof Error ? e : new Error(String(e)) };
      }
    });
    if (!r.ok) throw new StepFailure(r.error.message, { attempts: r.attempts });
    ctx.variables[outputVar] = r.value;
    helpers.setOutput({ result: r.value, attempts: r.attempts });
```

Replace the `http` handler from `const maxAttempts = …` to the final `throw` with:
```ts
    const timeoutMs = Math.min(60000, Number(cfg.timeoutMs ?? 30000));
    const failOnStatus = cfg.failOnStatus === true;
    const outputVar = (cfg.outputVar as string) ?? "httpResult";
    const send = async () => {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const r = await fetch(url, { ...init, signal: ac.signal });
        const text = await r.text();
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {}
        return { status: r.status, ok: r.ok, body };
      } finally {
        clearTimeout(t);
      }
    };
    const finish = (res: { status: number; ok: boolean; body: unknown }, extra: Record<string, unknown>) => {
      if (failOnStatus && !res.ok) {
        throw new StepFailure(`HTTP ${res.status}`, { status: res.status, body: res.body, ...extra });
      }
      ctx.variables[outputVar] = res.body;
      helpers.setOutput({ status: res.status, body: res.body, ...extra });
    };

    const retry = parseRetryConfig(cfg.retry);
    if (retry) {
      const r = await runWithRetry(retry, async () => {
        try {
          const res = await send();
          const retryable = res.status === 429 || res.status >= 500;
          return retryable
            ? { kind: "retry", error: new Error(`HTTP ${res.status}`), status: res.status, value: res }
            : { kind: "done", value: res, status: res.status };
        } catch (e) {
          return { kind: "retry", error: e instanceof Error ? e : new Error(String(e)) };
        }
      });
      if (r.ok) return finish(r.value, { attempts: r.attempts });
      if (r.value) return finish(r.value, { attempts: r.attempts });
      throw new StepFailure(r.error.message, { attempts: r.attempts });
    }

    // Legacy behaviour (no `retry` block): retry any non-2xx up to maxAttempts.
    const maxAttempts = Math.min(5, Number(cfg.maxAttempts ?? 1));
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await send();
        if (!res.ok && attempt < maxAttempts) {
          await new Promise((done) => setTimeout(done, 200 * Math.pow(2, attempt - 1)));
          continue;
        }
        return finish(res, { attempt });
      } catch (e) {
        if (e instanceof StepFailure) throw e;
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < maxAttempts) {
          await new Promise((done) => setTimeout(done, 200 * Math.pow(2, attempt - 1)));
        }
      }
    }
    throw lastError ?? new Error("HTTP request failed after retries");
```
Keep `const init: RequestInit = …` and the body interpolation above this block unchanged.

- [ ] **Step 8: Add the fields to the node registry**

In `lib/flows/node-registry.ts`, add to the `http` node's `fields` (advanced) and to the `integration` node's `fields` (advanced), following the existing field shape in that file (`key`, `label`, `type`, `help`, `advanced: true`):
- `http`: `failOnStatus` (boolean: "Fail the step when the final response is not 2xx"), `retry` (json: `{ "attempts": 3, "backoffMs": 1000, "maxBackoffMs": 30000 }`, help: "Retries network errors, 429 and 5xx. Replaces maxAttempts when set. Retries repeat the request: make sure it is safe to repeat.").
- `integration`: `retry` (json, same example, help: "Retries when the action fails. Retries repeat the action: make sure it is safe to repeat.").

Use the field `type` values that already exist in `lib/flows/field-types.ts` for booleans and JSON objects; if there is no JSON type, use the same type the `http` node uses for `headers`. Run `pnpm exec vitest run lib/flows/node-registry.test.ts` after the change.

- [ ] **Step 9: Run the tests**

Run: `pnpm exec vitest run __tests__/flow-engine-retry.test.ts __tests__/flow-engine.test.ts __tests__/phase-f2-flow-engine-rls.test.ts lib/flows`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/web/lib/flows/retry.ts apps/web/lib/flows/retry.test.ts apps/web/lib/flow-engine.ts apps/web/lib/flows/node-registry.ts apps/web/__tests__/flow-engine-harness.ts apps/web/__tests__/flow-engine-retry.test.ts
git diff --cached
git commit -s -m "feat(flows): retry integration and http steps with backoff and record every attempt"
```

---

### Task 5: `done` handle on `try_catch` and `parallel`

**Files:**
- Modify: `apps/web/lib/flow-engine.ts` (`parallel` and `try_catch` handlers, ~lines 1091-1118)
- Create: `apps/web/__tests__/flow-engine-done.test.ts`
- Modify: `apps/web/components/flows/nodes/BranchNode.tsx`
- Modify: `apps/web/components/flows/FlowBuilder.tsx:54-66` (nodeTypes)

**Interfaces:**
- Consumes: `runFlowGraph`, `dbMock`, `nextId` from `__tests__/flow-engine-harness.ts` (Task 4).
- Produces: engine contract — an edge with `sourceHandle: "done"` from a `try_catch` or `parallel` node runs once after the block, through `runFromNode`'s normal `nextHandle` path.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/__tests__/flow-engine-done.test.ts
import { describe, it, expect, vi } from "vitest";
import { runFlowGraph } from "./flow-engine-harness";

vi.mock("@orchester/db", async () => (await import("./flow-engine-harness")).dbMock);
vi.mock("drizzle-orm", async () => vi.importActual("drizzle-orm"));
vi.mock("@/lib/queue", () => ({ enqueue: vi.fn(), JOB_FLOW_RUN: "flow.run" }));
vi.mock("@/lib/net-guard", () => ({ assertPublicUrl: vi.fn() }));
vi.mock("@/lib/observability", () => ({ recordMetric: vi.fn(), logWithContext: vi.fn() }));
vi.mock("@/lib/llm-call", () => ({ llmCall: vi.fn(), llmStream: vi.fn() }));
vi.mock("@paralleldrive/cuid2", async () => {
  const { nextId } = await import("./flow-engine-harness");
  return { createId: () => nextId() };
});

const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({ id, type, label: id, config, position: { x: 0, y: 0 } });
const trigger = node("t", "trigger", { triggerKind: "manual" });
const set = (id: string, key: string) => node(id, "transform", { template: { [key]: "yes" } });
// An integration step with no integration selected throws "Falta elegir la app y la acción."
const boom = (id: string) => node(id, "integration", { integrationId: "" });
const e = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${target}-${sourceHandle ?? ""}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) });
const ran = (r: Awaited<ReturnType<typeof runFlowGraph>>) => r.steps.map((s) => s.nodeId);

describe("try_catch done", () => {
  it("runs done once after a successful try", async () => {
    const r = await runFlowGraph([trigger, node("tc", "try_catch"), set("a", "a"), set("d", "d")], [e("t", "tc"), e("tc", "a", "try"), e("tc", "d", "done")]);
    expect(r.status).toBe("succeeded");
    expect(ran(r)).toEqual(["t", "tc", "a", "d"]);
  });
  it("runs done after a caught error with a catch branch", async () => {
    const r = await runFlowGraph(
      [trigger, node("tc", "try_catch"), boom("x"), set("c", "c"), set("d", "d")],
      [e("t", "tc"), e("tc", "x", "try"), e("tc", "c", "catch"), e("tc", "d", "done")]
    );
    expect(r.status).toBe("succeeded");
    expect(ran(r)).toEqual(["t", "tc", "x", "c", "d"]);
  });
  it("runs done after a swallowed error without a catch branch", async () => {
    const r = await runFlowGraph([trigger, node("tc", "try_catch"), boom("x"), set("d", "d")], [e("t", "tc"), e("tc", "x", "try"), e("tc", "d", "done")]);
    expect(r.status).toBe("succeeded");
    expect(r.output).toMatchObject({ d: "yes" });
  });
  it("does not run done when the catch branch throws", async () => {
    const r = await runFlowGraph(
      [trigger, node("tc", "try_catch"), boom("x"), boom("c"), set("d", "d")],
      [e("t", "tc"), e("tc", "x", "try"), e("tc", "c", "catch"), e("tc", "d", "done")]
    );
    expect(r.status).toBe("failed");
    expect(ran(r)).not.toContain("d");
  });
  it("chains blocks: a failure in the second still runs the third and the final step", async () => {
    const r = await runFlowGraph(
      [trigger, node("b1", "try_catch"), set("a", "a"), node("b2", "try_catch"), boom("x"), node("b3", "try_catch"), set("c", "c"), set("f", "f")],
      [e("t", "b1"), e("b1", "a", "try"), e("b1", "b2", "done"), e("b2", "x", "try"), e("b2", "b3", "done"), e("b3", "c", "try"), e("b3", "f", "done")]
    );
    expect(r.status).toBe("succeeded");
    expect(r.output).toMatchObject({ a: "yes", c: "yes", f: "yes" });
    expect(ran(r).filter((id) => id === "f")).toHaveLength(1);
  });
  it("a try_catch without done behaves as before", async () => {
    const r = await runFlowGraph([trigger, node("tc", "try_catch"), set("a", "a"), set("z", "z")], [e("t", "tc"), e("tc", "a", "try"), e("tc", "z")]);
    expect(ran(r)).toEqual(["t", "tc", "a"]);
  });
});

describe("parallel done", () => {
  it("runs every branch, then done once, and done is not a branch", async () => {
    const r = await runFlowGraph(
      [trigger, node("p", "parallel"), set("a", "a"), set("b", "b"), set("d", "d")],
      [e("t", "p"), e("p", "a"), e("p", "b"), e("p", "d", "done")]
    );
    expect(r.status).toBe("succeeded");
    expect(ran(r).filter((id) => id === "d")).toHaveLength(1);
    expect(ran(r).indexOf("d")).toBeGreaterThan(Math.max(ran(r).indexOf("a"), ran(r).indexOf("b")));
  });
  it("does not run done when a branch fails", async () => {
    const r = await runFlowGraph(
      [trigger, node("p", "parallel"), boom("x"), set("d", "d")],
      [e("t", "p"), e("p", "x"), e("p", "d", "done")]
    );
    expect(r.status).toBe("failed");
    expect(ran(r)).not.toContain("d");
  });
});
```

- [ ] **Step 2: Run and see them fail**

Run: `pnpm exec vitest run __tests__/flow-engine-done.test.ts`
Expected: FAIL — `d` never runs; in the parallel case `d` runs as a branch.

- [ ] **Step 3: Implement**

Replace the two handlers in `lib/flow-engine.ts`:
```ts
  parallel: async ({ edges, node, nodes, ctx, runId, workspaceId, db, depth, helpers }) => {
    // Every outgoing edge except `done` is a branch. `done` runs once, after
    // all branches, through runFromNode's normal handle routing.
    const branchEdges = edges.filter((e) => e.source === node.id && e.sourceHandle !== "done");
    // B7: fan-out acotado. Mismo orden de resultados y misma semántica de error
    // (el primer fallo se propaga, y `done` no corre).
    await mapWithConcurrency(branchEdges, FLOW_MAX_FANOUT, (ed) =>
      runFromNode(ed.target, nodes, edges, ctx, runId, workspaceId, db, depth + 1)
    );
    helpers.setOutput({ branches: branchEdges.length });
    helpers.setHandle("done");
  },

  try_catch: async ({ cfg, edges, node, nodes, ctx, runId, workspaceId, db, depth, helpers }) => {
    const tryEdge = edges.find((e) => e.source === node.id && e.sourceHandle === "try");
    const catchEdge = edges.find((e) => e.source === node.id && e.sourceHandle === "catch");
    if (!tryEdge) throw new Error("try_catch: missing try branch");
    try {
      await runFromNode(tryEdge.target, nodes, edges, ctx, runId, workspaceId, db, depth + 1);
      helpers.setOutput({ caught: false });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      ctx.variables[(cfg.errorVar as string) ?? "error"] = err;
      if (catchEdge) {
        // A throwing catch branch propagates, and `done` does not run.
        await runFromNode(catchEdge.target, nodes, edges, ctx, runId, workspaceId, db, depth + 1);
      }
      helpers.setOutput({ caught: true, error: err });
    }
    // Only `done` edges continue; `try`/`catch` edges were handled above and
    // edges without a handle stay ignored, as before.
    helpers.setHandle("done");
  },
```

- [ ] **Step 4: Run the engine tests**

Run: `pnpm exec vitest run __tests__/flow-engine-done.test.ts __tests__/flow-engine-retry.test.ts __tests__/flow-engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Editor handles**

In `components/flows/nodes/BranchNode.tsx`:
- import `Rows3` from `lucide-react` alongside the existing icons, and `Handle, Position` are already imported;
- add the `done` handle to `TryCatchNode`:
```tsx
      branches={[
        { id: "try", label: "Intentar", color: "#3b82f6", top: 0.26 },
        { id: "catch", label: "Si falla", color: "#f59e0b", top: 0.52 },
        { id: "done", label: "Al terminar", color: "#10b981", top: 0.78 },
      ]}
```
- add a parallel node with an unnamed branch handle (existing edges have no `sourceHandle`) and a `done` handle:
```tsx
export function ParallelNode(p: NodeProps) {
  const data = p.data as NodeData;
  return (
    <div className="relative">
      <BranchNode
        data={data}
        Icon={Rows3}
        accent="#ec4899"
        branches={[{ id: "done", label: "Al terminar", color: "#10b981", top: 0.72 }]}
      />
      <span className="absolute right-3 text-[9px] font-medium" style={{ top: "calc(34% - 6px)", color: "#ec4899" }}>
        En paralelo
      </span>
      <Handle type="source" position={Position.Right} style={{ top: "34%", background: "#ec4899" }} />
    </div>
  );
}
```
In `components/flows/FlowBuilder.tsx`, import `ParallelNode` with the other branch nodes and set `parallel: ParallelNode` in `nodeTypes`.

- [ ] **Step 6: Type-check and commit**

Run: `pnpm exec tsc --noEmit 2>&1 | tail -5`
Expected: no new errors versus the Task 1 baseline.

```bash
git add apps/web/lib/flow-engine.ts apps/web/__tests__/flow-engine-done.test.ts apps/web/components/flows/nodes/BranchNode.tsx apps/web/components/flows/FlowBuilder.tsx
git diff --cached
git commit -s -m "feat(flows): continue after try_catch and parallel through a done handle"
```

---

### Task 6: Flow spec columns, step purpose and versions

**Files:**
- Modify: `packages/db/src/schema/flows.ts:98-116, 150-164`
- Create: `packages/db/migrations/0055_flow_spec.sql`
- Modify: `packages/db/scripts/apply-sql-migrations.mjs:63-84`
- Modify: `apps/web/lib/flows/normalize.ts`
- Modify: `apps/web/lib/flows/normalize.test.ts` (append)
- Create: `apps/web/lib/flows/versions.ts`
- Create: `apps/web/lib/flows/versions.test.ts`
- Modify: `apps/web/app/api/flows/[id]/versions/route.ts`, `apps/web/app/api/flows/[id]/versions/[vid]/restore/route.ts`
- Modify: `docs/specs/2026-09-17-mcp-flow-management-design.md` (migration sentence)

**Interfaces:**
- Produces:
  - `schema.flows.spec`, `schema.flowVersions.spec` (`text`, nullable).
  - `StoredFlowNode.purpose?: string`; `PURPOSE_MAX = 280`; `export function registryIdOf(type, config): string` from `normalize.ts`.
  - From `lib/flows/versions.ts`:
    ```ts
    export function versionSnapshot(flow: { nodes: unknown; edges: unknown; variables: unknown; spec: string | null }):
      { nodes: unknown[]; edges: unknown[]; variables: Record<string, unknown>; spec: string | null }
    export function restorePatch(version: { nodes: unknown; edges: unknown; variables: unknown; spec: string | null }):
      { nodes: unknown[]; edges: unknown[]; variables: Record<string, unknown>; spec: string | null }
    ```

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/lib/flows/normalize.test.ts`:
```ts
describe("purpose", () => {
  it("keeps a one-line purpose from the stored node or legacy data", () => {
    const out = normalizeFlowNodes([
      { id: "a", type: "note", label: "A", config: {}, position: { x: 0, y: 0 }, purpose: "Explain the flow" },
      { id: "b", type: "note", data: { label: "B", purpose: "line one\nline two" } },
    ]);
    expect(out[0]!.purpose).toBe("Explain the flow");
    expect(out[1]!.purpose).toBe("line one line two");
  });
  it("truncates past 280 characters and drops empty purposes", () => {
    const out = normalizeFlowNodes([
      { id: "a", type: "note", config: {}, purpose: "x".repeat(300) },
      { id: "b", type: "note", config: {}, purpose: "   " },
    ]);
    expect(out[0]!.purpose).toHaveLength(280);
    expect(out[1]).not.toHaveProperty("purpose");
  });
});
```

```ts
// apps/web/lib/flows/versions.test.ts
import { describe, it, expect } from "vitest";
import { versionSnapshot, restorePatch } from "./versions";

describe("flow versions carry the spec", () => {
  it("snapshots the spec with the graph", () => {
    expect(versionSnapshot({ nodes: [{ id: "n" }], edges: null, variables: undefined, spec: "## Purpose" })).toEqual({
      nodes: [{ id: "n" }], edges: [], variables: {}, spec: "## Purpose",
    });
  });
  it("restores the spec with the graph, including a null spec", () => {
    expect(restorePatch({ nodes: [], edges: [], variables: { a: 1 }, spec: null })).toEqual({
      nodes: [], edges: [], variables: { a: 1 }, spec: null,
    });
  });
});
```

- [ ] **Step 2: Run and see them fail**

Run: `pnpm exec vitest run lib/flows/normalize.test.ts lib/flows/versions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`packages/db/src/schema/flows.ts` — add after `description` in `flows`, and after `label` in `flowVersions`:
```ts
  /** Markdown specification: what the flow does and why. */
  spec: text("spec"),
```

`packages/db/migrations/0055_flow_spec.sql`:
```sql
-- packages/db/migrations/0055_flow_spec.sql
--
-- Long-form, versioned flow documentation. Both columns are nullable, so the
-- migration is safe to apply before the application that reads them starts.
ALTER TABLE flow ADD COLUMN IF NOT EXISTS spec text;
ALTER TABLE flow_version ADD COLUMN IF NOT EXISTS spec text;
```

`apply-sql-migrations.mjs` — add before the unnumbered single-tenant entry:
```js
  ["0055_flow_spec.sql", "columnas flow.spec y flow_version.spec (documentación del flujo)"],
```

`lib/flows/normalize.ts`:
- export `registryIdOf` (add `export` to the existing function);
- add `purpose?: string;` to `StoredFlowNode`;
- add near the top:
```ts
export const PURPOSE_MAX = 280;

function purposeOf(item: Record<string, unknown>, data: Record<string, unknown>): string | undefined {
  const raw = [item.purpose, data.purpose].find((p): p is string => typeof p === "string");
  const oneLine = raw?.replace(/\s*[\r\n]+\s*/g, " ").trim();
  return oneLine ? oneLine.slice(0, PURPOSE_MAX) : undefined;
}
```
- in `normalizeFlowNodes`, compute `const purpose = purposeOf(item, data);` next to `label`, and push `{ id, type, label: …, config, position, ...(purpose ? { purpose } : {}) }`. Leave the unknown-type branch unchanged (Task 7 rejects those before normalization).

`lib/flows/versions.ts`:
```ts
/** Flow version snapshots and restores. The spec travels with the graph. */
interface GraphLike {
  nodes: unknown;
  edges: unknown;
  variables: unknown;
  spec: string | null;
}

function toPatch(src: GraphLike) {
  return {
    nodes: Array.isArray(src.nodes) ? src.nodes : [],
    edges: Array.isArray(src.edges) ? src.edges : [],
    variables:
      src.variables && typeof src.variables === "object" && !Array.isArray(src.variables)
        ? (src.variables as Record<string, unknown>)
        : {},
    spec: src.spec ?? null,
  };
}

export const versionSnapshot = (flow: GraphLike) => toPatch(flow);
export const restorePatch = (version: GraphLike) => toPatch(version);
```

`versions/route.ts` POST: replace the `nodes/edges/variables` lines of the insert with `...versionSnapshot(flow),` (import from `@/lib/flows/versions`).
`restore/route.ts`: replace the `nodes/edges/variables` lines of the update with `...restorePatch(v),`.

Spec doc: in `## Design` §4, replace "migration generated with `drizzle-kit generate`, applied by `migrate`" with "hand-written migration `packages/db/migrations/0055_flow_spec.sql`, added to the manifest of `scripts/apply-sql-migrations.mjs`; the drizzle snapshot is stale versus the schema, so `drizzle-kit generate` would emit unrelated changes".

- [ ] **Step 4: Run tests and type-check**

Run: `pnpm exec vitest run lib/flows && pnpm exec tsc --noEmit 2>&1 | tail -5`
Expected: PASS; no new type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/db apps/web/lib/flows/normalize.ts apps/web/lib/flows/normalize.test.ts apps/web/lib/flows/versions.ts apps/web/lib/flows/versions.test.ts "apps/web/app/api/flows/[id]/versions" docs/specs/2026-09-17-mcp-flow-management-design.md
git diff --cached
git commit -s -m "feat(flows): store a versioned spec per flow and a purpose per step"
```

---

### Task 7: Validation of stored flows and documentation warnings

**Files:**
- Modify: `apps/web/lib/flows/validate.ts`
- Modify: `apps/web/lib/flows/validate.test.ts` (append)
- Create: `apps/web/lib/flows/validate-stored.ts`
- Create: `apps/web/lib/flows/validate-stored.test.ts`

**Interfaces:**
- Consumes: `normalizeFlowNodes`, `normalizeFlowEdges`, `registryIdOf` (Task 6); `findTemplateErrors` (Task 3).
- Produces:
  - `validateFlow(nodes, edges, locale = "es", docs?: { spec: string | null })` — `VNode.data` gains `purpose?: string`; when `docs` is given, adds the two warnings.
  - `validateStoredFlow(rawNodes: unknown, rawEdges: unknown, opts?: { spec?: string | null; locale?: Locale }): ValidationIssue[]` from `@/lib/flows/validate-stored`.
  - `hasErrors(issues: ValidationIssue[]): boolean` from the same module.

- [ ] **Step 1: Write the failing tests**

Append to `validate.test.ts` (reuse the file's existing node helpers if it has them; otherwise build `VNode` objects inline as below):
```ts
describe("documentation warnings", () => {
  const trigger = { id: "t", type: "trigger", data: { nodeId: "trigger_manual", config: {} } };
  const step = (purpose?: string) => ({ id: "s", type: "transform", data: { nodeId: "transform", config: { template: "{}" }, ...(purpose ? { purpose } : {}) } });
  const edges = [{ id: "e", source: "t", target: "s" }];

  it("warns about a missing spec and a step without purpose, only when docs are checked", () => {
    expect(validateFlow([trigger, step()], edges).some((i) => /documentación|propósito/.test(i.message))).toBe(false);
    const issues = validateFlow([trigger, step()], edges, "es", { spec: null });
    expect(issues.filter((i) => i.level === "warning").map((i) => i.message).join(" ")).toMatch(/documentación/);
    expect(issues.some((i) => i.nodeId === "s" && /propósito/.test(i.message))).toBe(true);
    expect(issues.every((i) => i.level === "warning" || !/documentación|propósito/.test(i.message))).toBe(true);
  });
  it("is quiet when spec and purposes are present", () => {
    const issues = validateFlow([trigger, step("Build the payload")], edges, "es", { spec: "## Purpose" });
    expect(issues.some((i) => /documentación|propósito/.test(i.message))).toBe(false);
  });
});
```

```ts
// apps/web/lib/flows/validate-stored.test.ts
import { describe, it, expect } from "vitest";
import { validateStoredFlow, hasErrors } from "./validate-stored";

const trigger = { id: "t", type: "trigger", label: "Start", config: { triggerKind: "manual" }, position: { x: 0, y: 0 }, purpose: "Start by hand" };
const transform = (id: string, template: unknown, purpose = "Shape data") => ({ id, type: "transform", label: id, config: { template }, position: { x: 0, y: 0 }, purpose });

describe("validateStoredFlow", () => {
  it("validates flat stored nodes like the editor does", () => {
    const missing = { id: "a", type: "agent", label: "A", config: {}, position: { x: 0, y: 0 }, purpose: "Answer" };
    const issues = validateStoredFlow([trigger, missing], [{ id: "e", source: "t", target: "a" }], { spec: "x" });
    expect(issues.some((i) => i.level === "error" && i.nodeId === "a")).toBe(true);
  });
  it("rejects unknown raw types before normalization hides them", () => {
    const issues = validateStoredFlow([trigger, { id: "z", type: "teleport", config: {} }], [], { spec: "x" });
    expect(hasErrors(issues)).toBe(true);
    expect(issues.find((i) => i.nodeId === "z")?.message).toMatch(/teleport/);
  });
  it("accepts legacy types that have an equivalent", () => {
    const issues = validateStoredFlow([trigger, { id: "b", type: "branch", config: {} }], [], { spec: "x" });
    expect(issues.some((i) => i.nodeId === "b" && /teleport|desconocido/.test(i.message))).toBe(false);
  });
  it("reports bad filters in any config string as errors", () => {
    const issues = validateStoredFlow([trigger, transform("x", { a: "{{b | nope}}" })], [{ id: "e", source: "t", target: "x" }], { spec: "x" });
    expect(issues.some((i) => i.level === "error" && i.nodeId === "x" && /nope/.test(i.message))).toBe(true);
  });
  it("allows done edges only from try_catch, parallel and loop_for_each", () => {
    const bad = validateStoredFlow(
      [trigger, transform("x", "{}"), transform("y", "{}")],
      [{ id: "e1", source: "t", target: "x" }, { id: "e2", source: "x", target: "y", sourceHandle: "done" }],
      { spec: "x" }
    );
    expect(bad.some((i) => i.level === "error" && /done/.test(i.message))).toBe(true);
    const ok = validateStoredFlow(
      [trigger, { id: "tc", type: "try_catch", label: "tc", config: {}, position: { x: 0, y: 0 }, purpose: "p" }, transform("y", "{}")],
      [{ id: "e1", source: "t", target: "tc" }, { id: "e2", source: "tc", target: "y", sourceHandle: "done" }],
      { spec: "x" }
    );
    expect(ok.some((i) => /done/.test(i.message))).toBe(false);
  });
  it("returns documentation warnings, never errors, for missing spec and purpose", () => {
    const issues = validateStoredFlow([trigger, transform("x", "{}", "")], [{ id: "e", source: "t", target: "x" }], {});
    expect(issues.filter((i) => /documentación|propósito/.test(i.message)).every((i) => i.level === "warning")).toBe(true);
    expect(issues.some((i) => /documentación/.test(i.message))).toBe(true);
  });
  it("accepts an empty graph", () => {
    expect(hasErrors(validateStoredFlow([], [], {}))).toBe(false);
  });
});
```

- [ ] **Step 2: Run and see them fail**

Run: `pnpm exec vitest run lib/flows/validate.test.ts lib/flows/validate-stored.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `validate.ts`:
- `VNode.data` type becomes `{ nodeId?: string; label?: string; config?: Record<string, unknown>; purpose?: string }`;
- signature: `export function validateFlow(nodes: VNode[], edges: VEdge[], locale: Locale = "es", docs?: { spec: string | null }): ValidationIssue[]`;
- before `return issues;` add:
```ts
  // 5. Documentación (sólo avisos). Se chequea cuando quien valida la conoce.
  if (docs) {
    if (nodes.length > 0 && !docs.spec?.trim()) {
      issues.push({
        level: "warning",
        message:
          "El flujo no tiene documentación. Escribí qué hace y por qué en la pestaña Documentación.",
      });
    }
    for (const n of nodes) {
      const engine = getNodeDef(String(n.data?.nodeId ?? n.type ?? ""))?.engine ?? n.type;
      if (engine === "trigger" || engine === "note") continue;
      if (!n.data?.purpose?.trim()) {
        issues.push({
          level: "warning",
          nodeId: n.id,
          message: `El paso "${labelOf(n)}" no dice para qué está. Completá su propósito.`,
        });
      }
    }
  }
```

`lib/flows/validate-stored.ts`:
```ts
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
        issues.push({ level: "error", nodeId: n.id, message: `Variable mal escrita en "${n.label}": ${problem}` });
      }
    }
  }

  const typeOf = new Map(nodes.map((n) => [n.id, n.type]));
  for (const e of edges) {
    if (e.sourceHandle === "done" && !DONE_SOURCES.has(typeOf.get(e.source) ?? "")) {
      issues.push({
        level: "error",
        nodeId: e.source,
        message: 'Sólo "Intentar/Si falla", "En paralelo" y "Por cada uno" tienen la salida "done".',
      });
    }
  }
  return issues;
}
```
`FLOW_NODE_TYPES` lives in `lib/flow-engine.ts`, which is server-only. Move the `FLOW_NODE_TYPES` array and `FlowNodeType` type into a new client-safe `apps/web/lib/flows/node-types.ts`, and in `flow-engine.ts` replace their definitions with `export { FLOW_NODE_TYPES, type FlowNodeType } from "./flows/node-types";` plus `import { FLOW_NODE_TYPES, type FlowNodeType } from "./flows/node-types";` if the file uses them locally. Keep the doc comment with the moved array.

Also export `VNode` (already exported) and make sure `labelOf` is in scope for the new block (it is declared inside `validateFlow`).

- [ ] **Step 4: Run and commit**

Run: `pnpm exec vitest run lib/flows && pnpm exec tsc --noEmit 2>&1 | tail -5`
Expected: PASS; no new type errors.

```bash
git add apps/web/lib/flows apps/web/lib/flow-engine.ts
git diff --cached
git commit -s -m "feat(flows): validate stored flows and warn about undocumented flows and steps"
```

---

### Task 8: Audit entries inside the caller's transaction

**Files:**
- Modify: `apps/web/lib/audit/log.ts`
- Create: `apps/web/__tests__/audit-in-tx.test.ts`

**Interfaces:**
- Produces: `appendAuditInTx(tx: AuditTx, workspaceId: string, entry: AuditEntryInput): Promise<{ rotatedAtSeq: bigint | null }>` and `type AuditTx` from `@/lib/audit/log`. `appendAuditSync` keeps its signature and behaviour.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/__tests__/audit-in-tx.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@orchester/db", () => ({
  getDb: vi.fn(() => { throw new Error("appendAuditInTx must not open its own transaction"); }),
  schema: { auditLog: { seq: "seq", chainHash: "chain_hash", workspaceId: "workspace_id" } },
}));

describe("appendAuditInTx", () => {
  it("writes through the given transaction", async () => {
    const inserted: Record<string, unknown>[] = [];
    const tx = {
      execute: vi.fn(async () => ({ rows: [] })),
      select: () => tx,
      from: () => tx,
      where: () => tx,
      orderBy: () => tx,
      limit: async () => [],
      insert: () => ({ values: async (row: Record<string, unknown>) => void inserted.push(row) }),
    };
    const { appendAuditInTx } = await import("../lib/audit/log");
    await appendAuditInTx(tx as never, "ws_test", {
      action: "flow.update",
      actorUserId: null,
      actorKind: "api_key",
      targetType: "flow",
      targetId: "flow_1",
      meta: { apiKeyId: "key_1" },
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ actorKind: "api_key", actorUserId: null, meta: { apiKeyId: "key_1" }, seq: BigInt(1) });
    expect(tx.execute).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `pnpm exec vitest run __tests__/audit-in-tx.test.ts`
Expected: FAIL, `appendAuditInTx` is not exported.

- [ ] **Step 3: Implement**

In `lib/audit/log.ts`:
- add `export type AuditTx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];`
- move everything inside `db.transaction(async (tx) => { … })` into:
```ts
export async function appendAuditInTx(
  tx: AuditTx,
  workspaceId: string,
  entry: AuditEntryInput
): Promise<{ rotatedAtSeq: bigint | null }> {
  // …the moved body, unchanged, with `rotatedFromLegacyBootstrap = true;
  // rotatedAtSeq = nextSeq;` replaced by `rotated = nextSeq;`…
  return { rotatedAtSeq: rotated };
}
```
  declaring `let rotated: bigint | null = null;` at the top of the function;
- rewrite `appendAuditSync` as:
```ts
export async function appendAuditSync(workspaceId: string, entry: AuditEntryInput): Promise<void> {
  const db = getDb();
  const { rotatedAtSeq } = await db.transaction((tx) => appendAuditInTx(tx, workspaceId, entry));
  // Post-commit observability (unchanged comment block).
  if (rotatedAtSeq !== null) {
    const { safeLogWarn } = await import("../safe-log");
    safeLogWarn("[audit] chain rotated past legacy bootstrap row:", {
      level: "warn",
      msg: "audit.chain.rotated_past_legacy_bootstrap",
      workspaceId,
      seq: rotatedAtSeq.toString(),
    });
  }
}
```
  and add a doc comment on `appendAuditInTx`: it does not log the rotation; callers that care log after their commit.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm exec vitest run __tests__/audit-in-tx.test.ts && pnpm exec vitest run $(git ls-files 'apps/web/**/*audit*.test.ts' | sed 's#apps/web/##')`
Expected: PASS.

```bash
git add apps/web/lib/audit/log.ts apps/web/__tests__/audit-in-tx.test.ts
git diff --cached
git commit -s -m "feat(audit): append an audit entry inside the caller's transaction"
```

---

### Task 9: Flow service and thin session routes

**Files:**
- Create: `apps/web/lib/flows/service.ts`
- Create: `apps/web/__tests__/flow-service.test.ts`
- Modify: `apps/web/app/api/flows/route.ts`, `apps/web/app/api/flows/[id]/route.ts`, `apps/web/app/api/flows/[id]/webhooks/route.ts`, `apps/web/app/api/flow-runs/[id]/route.ts`, `apps/web/app/api/flows/[id]/runs/route.ts`

**Interfaces:**
- Consumes: `withWorkspaceTx` (`@/lib/tenant/context`), `appendAuditInTx` (Task 8), `logAudit` (`@/lib/audit`), `validateStoredFlow`, `hasErrors` (Task 7), `normalizeFlowNodes/Edges`, `checkQuota` (`@/lib/billing/quotas`).
- Produces (from `@/lib/flows/service`):
```ts
export type FlowActor =
  | { kind: "user"; workspaceId: string; userId: string }
  | { kind: "apiKey"; workspaceId: string; keyId: string };
export class FlowServiceError extends Error {
  constructor(readonly code: "not_found" | "invalid" | "quota" | "template_not_found", message: string, readonly issues?: ValidationIssue[]) }
export interface FlowInput { name?: string; description?: string | null; spec?: string | null; nodes?: unknown[]; edges?: unknown[]; variables?: Record<string, unknown>; status?: "draft" | "active" | "paused"; trigger?: "manual" | "webhook" | "schedule" | "conversation"; triggerConfig?: Record<string, unknown>; enabled?: boolean; templateId?: string }
export function listFlows(actor: FlowActor): Promise<Flow[]>
export function getFlow(actor: FlowActor, flowId: string): Promise<Flow>                         // throws not_found
export function createFlow(actor: FlowActor, input: FlowInput & { name: string }, opts?: { strict?: boolean }): Promise<{ flow: Flow; warnings: ValidationIssue[] }>
export function updateFlow(actor: FlowActor, flowId: string, input: FlowInput, opts?: { strict?: boolean }): Promise<{ flow: Flow; warnings: ValidationIssue[] }>
export function validateFlowById(actor: FlowActor, flowId: string): Promise<ValidationIssue[]>
export function getFlowRun(actor: FlowActor, runId: string): Promise<{ run: FlowRun; steps: FlowRunStep[] }>
export function listFlowRuns(actor: FlowActor, flowId: string, limit?: number): Promise<FlowRun[]>
export function createFlowWebhook(actor: FlowActor, flowId: string, opts: { hmac?: boolean }): Promise<FlowWebhook>
export function listFlowWebhooks(actor: FlowActor, flowId: string, opts?: { redact?: boolean }): Promise<Array<FlowWebhook | RedactedFlowWebhook>>
export function webhookUrl(secret: string): string
```
`Flow`, `FlowRun`, `FlowRunStep`, `FlowWebhook` are the Drizzle select types (`typeof schema.flows.$inferSelect`, …). `strict: true` (MCP) rejects error-level issues with `FlowServiceError("invalid", …, issues)`; routes pass `strict: false`, keeping the editor free to save drafts.

- [ ] **Step 1: Read the current handlers**

Read the five route files listed above in full, including `runs/route.ts`, so the moved behaviour matches exactly (quota message and 402, template lookup and 404, `normalizeFlow*`, audit on create/update/delete, response codes).

- [ ] **Step 2: Write the failing service tests**

```ts
// apps/web/__tests__/flow-service.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  flows: [] as Array<Record<string, unknown>>,
  runs: [] as Array<Record<string, unknown>>,
  steps: [] as Array<Record<string, unknown>>,
  webhooks: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  failAudit: false,
}));

// The service only talks to the DB through small repository helpers defined in
// service.ts (see Step 3); the test replaces them wholesale.
vi.mock("@/lib/flows/flow-repo", () => ({
  withRepo: async (_ws: string, fn: (repo: unknown) => Promise<unknown>) =>
    fn({
      findFlow: async (id: string, ws: string) => db.flows.find((f) => f.id === id && f.workspaceId === ws),
      listFlows: async (ws: string) => db.flows.filter((f) => f.workspaceId === ws),
      insertFlow: async (row: Record<string, unknown>) => (db.flows.push(row), row),
      updateFlow: async (id: string, ws: string, patch: Record<string, unknown>) => {
        const f = db.flows.find((x) => x.id === id && x.workspaceId === ws);
        if (f) Object.assign(f, patch);
        return f;
      },
      findRun: async (id: string, ws: string) => db.runs.find((r) => r.id === id && r.workspaceId === ws),
      listSteps: async (runId: string) => db.steps.filter((s) => s.runId === runId),
      listRuns: async (flowId: string, ws: string, limit: number) => db.runs.filter((r) => r.flowId === flowId && r.workspaceId === ws).slice(0, limit),
      insertWebhook: async (row: Record<string, unknown>) => (db.webhooks.push(row), row),
      listWebhooks: async (flowId: string, ws: string) => db.webhooks.filter((w) => w.flowId === flowId && w.workspaceId === ws),
      findTemplate: async () => undefined,
      audit: async (_ws: string, entry: Record<string, unknown>) => {
        if (db.failAudit) throw new Error("audit down");
        db.audits.push(entry);
      },
    }),
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async (e: Record<string, unknown>) => void db.audits.push(e)) }));
vi.mock("@/lib/billing/quotas", () => ({ checkQuota: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@paralleldrive/cuid2", () => ({ createId: () => `id_${Math.random().toString(36).slice(2)}` }));

const key = { kind: "apiKey", workspaceId: "ws_a", keyId: "key_1" } as const;
const user = { kind: "user", workspaceId: "ws_a", userId: "user_1" } as const;
const trigger = { id: "t", type: "trigger", label: "Start", config: { triggerKind: "manual" }, position: { x: 0, y: 0 } };

beforeEach(() => {
  db.flows = [{ id: "f_other", workspaceId: "ws_b", name: "theirs", nodes: [], edges: [], variables: {}, spec: null }];
  db.runs = [{ id: "r_other", workspaceId: "ws_b", flowId: "f_other" }];
  db.steps = [];
  db.webhooks = [];
  db.audits = [];
  db.failAudit = false;
});

describe("flow service", async () => {
  const svc = await import("@/lib/flows/service");

  it("never returns another workspace's flow or run", async () => {
    await expect(svc.getFlow(key, "f_other")).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.getFlowRun(key, "r_other")).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.createFlowWebhook(key, "f_other", {})).rejects.toMatchObject({ code: "not_found" });
    expect(db.webhooks).toHaveLength(0);
  });

  it("strict create rejects error-level graphs with their issues", async () => {
    const bad = { id: "z", type: "teleport", config: {} };
    await expect(svc.createFlow(key, { name: "x", nodes: [trigger, bad] }, { strict: true })).rejects.toMatchObject({
      code: "invalid",
      issues: expect.arrayContaining([expect.objectContaining({ nodeId: "z" })]),
    });
  });

  it("non-strict create keeps saving drafts, normalized", async () => {
    const { flow } = await svc.createFlow(user, { name: " Draft ", nodes: [{ id: "n", type: "note", data: { label: "N" } }] });
    expect(flow.name).toBe("Draft");
    expect((flow.nodes as Array<{ label: string }>)[0]!.label).toBe("N");
  });

  it("stores spec and purpose and returns documentation warnings", async () => {
    const { flow, warnings } = await svc.createFlow(key, { name: "doc", nodes: [trigger], spec: null }, { strict: true });
    expect(flow.spec).toBeNull();
    expect(warnings.some((w) => w.level === "warning")).toBe(true);
    const { flow: updated } = await svc.updateFlow(key, flow.id as string, { spec: "## Purpose" }, { strict: true });
    expect(updated.spec).toBe("## Purpose");
  });

  it("audits API-key writes with the key id and no user", async () => {
    await svc.createFlow(key, { name: "a" }, { strict: true });
    expect(db.audits.at(-1)).toMatchObject({ actorKind: "api_key", actorUserId: null, meta: expect.objectContaining({ apiKeyId: "key_1" }) });
  });

  it("an API-key write fails when its audit entry cannot be written", async () => {
    db.failAudit = true;
    await expect(svc.createFlow(key, { name: "a" }, { strict: true })).rejects.toThrow("audit down");
  });

  it("creates a webhook with a usable URL and lists webhooks without secrets", async () => {
    db.flows.push({ id: "f_mine", workspaceId: "ws_a", name: "mine", nodes: [], edges: [], variables: {}, spec: null });
    const hook = await svc.createFlowWebhook(key, "f_mine", { hmac: true });
    expect(svc.webhookUrl(hook.secret)).toMatch(new RegExp(`/api/webhooks/${hook.secret}$`));
    const listed = await svc.listFlowWebhooks(key, "f_mine", { redact: true });
    expect(JSON.stringify(listed)).not.toContain(hook.secret);
    expect(listed[0]).toMatchObject({ id: hook.id, hmac: true });
  });

  it("caps list_flow_runs at 100", async () => {
    db.flows.push({ id: "f_mine", workspaceId: "ws_a", name: "mine", nodes: [], edges: [], variables: {}, spec: null });
    db.runs.push(...Array.from({ length: 150 }, (_, i) => ({ id: `r${i}`, workspaceId: "ws_a", flowId: "f_mine" })));
    expect(await svc.listFlowRuns(key, "f_mine", 500)).toHaveLength(100);
    expect(await svc.listFlowRuns(key, "f_mine")).toHaveLength(20);
  });
});
```

- [ ] **Step 3: Implement the repository and the service**

Create `apps/web/lib/flows/flow-repo.ts` (server-only) — the only module in this task that touches Drizzle:
```ts
import "server-only";
import { schema } from "@orchester/db";
import { and, desc, eq, or, asc } from "drizzle-orm";
import { withWorkspaceTx } from "@/lib/tenant/context";
import { appendAuditInTx } from "@/lib/audit/log";
import type { AuditEntryInput } from "@/lib/audit/types";

type Tx = Parameters<Parameters<typeof withWorkspaceTx>[1]>[0];

function repo(tx: Tx) {
  return {
    findFlow: async (id: string, ws: string) =>
      (await tx.select().from(schema.flows).where(and(eq(schema.flows.id, id), eq(schema.flows.workspaceId, ws))).limit(1))[0],
    listFlows: (ws: string) =>
      tx.select().from(schema.flows).where(eq(schema.flows.workspaceId, ws)).orderBy(desc(schema.flows.updatedAt)),
    insertFlow: async (row: typeof schema.flows.$inferInsert) =>
      (await tx.insert(schema.flows).values(row).returning())[0]!,
    updateFlow: async (id: string, ws: string, patch: Partial<typeof schema.flows.$inferInsert>) =>
      (await tx.update(schema.flows).set(patch).where(and(eq(schema.flows.id, id), eq(schema.flows.workspaceId, ws))).returning())[0],
    findRun: async (id: string, ws: string) =>
      (await tx.select().from(schema.flowRuns).where(and(eq(schema.flowRuns.id, id), eq(schema.flowRuns.workspaceId, ws))).limit(1))[0],
    listSteps: (runId: string) =>
      tx.select().from(schema.flowRunSteps).where(eq(schema.flowRunSteps.runId, runId)).orderBy(asc(schema.flowRunSteps.startedAt)),
    listRuns: (flowId: string, ws: string, limit: number) =>
      tx.select().from(schema.flowRuns)
        .where(and(eq(schema.flowRuns.flowId, flowId), eq(schema.flowRuns.workspaceId, ws)))
        .orderBy(desc(schema.flowRuns.startedAt)).limit(limit),
    insertWebhook: async (row: typeof schema.flowWebhooks.$inferInsert) =>
      (await tx.insert(schema.flowWebhooks).values(row).returning())[0]!,
    listWebhooks: (flowId: string, ws: string) =>
      tx.select().from(schema.flowWebhooks)
        .where(and(eq(schema.flowWebhooks.flowId, flowId), eq(schema.flowWebhooks.workspaceId, ws)))
        .orderBy(desc(schema.flowWebhooks.createdAt)),
    findTemplate: async (id: string, ws: string) =>
      (await tx.select().from(schema.flowTemplates)
        .where(and(eq(schema.flowTemplates.id, id), or(eq(schema.flowTemplates.isPublic, true), eq(schema.flowTemplates.workspaceId, ws))))
        .limit(1))[0],
    audit: (ws: string, entry: AuditEntryInput) => appendAuditInTx(tx as never, ws, entry).then(() => undefined),
  };
}

export type FlowRepo = ReturnType<typeof repo>;

export function withRepo<T>(workspaceId: string, fn: (r: FlowRepo) => Promise<T>): Promise<T> {
  return withWorkspaceTx(workspaceId, (tx) => fn(repo(tx)));
}
```
Check the real column names before relying on them: `flowRuns.startedAt` and `flowRunSteps.startedAt` (the existing `flow-runs/[id]` route orders by `flowRunSteps.startedAt`), `flowTemplates.isPublic`. If `flowRuns` has no `startedAt`, order by `createdAt`.

Create `apps/web/lib/flows/service.ts`:
```ts
import "server-only";
import crypto from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import type { schema } from "@orchester/db";
import { logAudit } from "@/lib/audit";
import { checkQuota } from "@/lib/billing/quotas";
import { withRepo, type FlowRepo } from "./flow-repo";
import { normalizeFlowNodes, normalizeFlowEdges } from "./normalize";
import { validateStoredFlow, hasErrors } from "./validate-stored";
import type { ValidationIssue } from "./validate";

export type Flow = typeof schema.flows.$inferSelect;
export type FlowRun = typeof schema.flowRuns.$inferSelect;
export type FlowRunStep = typeof schema.flowRunSteps.$inferSelect;
export type FlowWebhook = typeof schema.flowWebhooks.$inferSelect;
export interface RedactedFlowWebhook { id: string; flowId: string; hmac: boolean; createdAt: Date }

export type FlowActor =
  | { kind: "user"; workspaceId: string; userId: string }
  | { kind: "apiKey"; workspaceId: string; keyId: string };

export class FlowServiceError extends Error {
  constructor(
    readonly code: "not_found" | "invalid" | "quota" | "template_not_found",
    message: string,
    readonly issues?: ValidationIssue[]
  ) {
    super(message);
    this.name = "FlowServiceError";
  }
}

export interface FlowInput {
  name?: string;
  description?: string | null;
  spec?: string | null;
  nodes?: unknown[];
  edges?: unknown[];
  variables?: Record<string, unknown>;
  status?: "draft" | "active" | "paused";
  trigger?: "manual" | "webhook" | "schedule" | "conversation";
  triggerConfig?: Record<string, unknown>;
  enabled?: boolean;
  templateId?: string;
}

const notFound = (what: string) => new FlowServiceError("not_found", `${what} not found`);

async function requireFlow(repo: FlowRepo, actor: FlowActor, id: string): Promise<Flow> {
  const flow = await repo.findFlow(id, actor.workspaceId);
  if (!flow) throw notFound("Flow");
  return flow as Flow;
}

/**
 * API-key writes are audited inside the same transaction: the change and its
 * audit entry commit together. User writes keep the fire-and-forget audit.
 */
async function audit(repo: FlowRepo, actor: FlowActor, action: string, flow: Flow) {
  if (actor.kind === "apiKey") {
    await repo.audit(actor.workspaceId, {
      action,
      actorUserId: null,
      actorKind: "api_key",
      targetType: "flow",
      targetId: flow.id,
      meta: { apiKeyId: actor.keyId, after: { name: flow.name } },
    });
  }
}

function auditUser(actor: FlowActor, action: string, flow: Flow) {
  if (actor.kind !== "user") return;
  void logAudit({
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    action,
    resource: "flow",
    resourceId: flow.id,
    after: { name: flow.name },
  });
}

function checkGraph(nodes: unknown[], edges: unknown[], spec: string | null, strict: boolean): ValidationIssue[] {
  if (!strict) return [];
  const issues = validateStoredFlow(nodes, edges, { spec });
  if (hasErrors(issues)) {
    throw new FlowServiceError("invalid", "The flow has errors", issues.filter((i) => i.level === "error"));
  }
  return issues;
}

export function listFlows(actor: FlowActor): Promise<Flow[]> {
  return withRepo(actor.workspaceId, async (repo) => (await repo.listFlows(actor.workspaceId)) as Flow[]);
}

export function getFlow(actor: FlowActor, flowId: string): Promise<Flow> {
  return withRepo(actor.workspaceId, (repo) => requireFlow(repo, actor, flowId));
}

export async function createFlow(
  actor: FlowActor,
  input: FlowInput & { name: string },
  { strict = false }: { strict?: boolean } = {}
): Promise<{ flow: Flow; warnings: ValidationIssue[] }> {
  const quota = await checkQuota(actor.workspaceId, "flows");
  if (!quota.allowed) throw new FlowServiceError("quota", quota.reason ?? "Flow quota exceeded for your plan");
  const result = await withRepo(actor.workspaceId, async (repo) => {
    let nodes: unknown[] = input.nodes ?? [];
    let edges: unknown[] = input.edges ?? [];
    let variables: Record<string, unknown> = input.variables ?? {};
    if (input.templateId) {
      // Server-stored templates win over an inline seed.
      const t = await repo.findTemplate(input.templateId, actor.workspaceId);
      if (!t) throw new FlowServiceError("template_not_found", "Template not found");
      nodes = (t.nodes as unknown[]) ?? [];
      edges = (t.edges as unknown[]) ?? [];
      variables = (t.variables as Record<string, unknown>) ?? {};
    }
    const spec = input.spec ?? null;
    const warnings = checkGraph(nodes, edges, spec, strict);
    const flow = (await repo.insertFlow({
      id: createId(),
      workspaceId: actor.workspaceId,
      name: input.name.trim(),
      description: input.description ?? null,
      spec,
      nodes: normalizeFlowNodes(nodes) as never,
      edges: normalizeFlowEdges(edges) as never,
      variables,
    })) as Flow;
    await audit(repo, actor, "flow.create", flow);
    return { flow, warnings };
  });
  auditUser(actor, "flow.create", result.flow);
  return result;
}

export async function updateFlow(
  actor: FlowActor,
  flowId: string,
  input: FlowInput,
  { strict = false }: { strict?: boolean } = {}
): Promise<{ flow: Flow; warnings: ValidationIssue[] }> {
  const result = await withRepo(actor.workspaceId, async (repo) => {
    const current = await requireFlow(repo, actor, flowId);
    const nodes = input.nodes ?? (current.nodes as unknown[]) ?? [];
    const edges = input.edges ?? (current.edges as unknown[]) ?? [];
    const spec = input.spec !== undefined ? input.spec : current.spec;
    const warnings = checkGraph(nodes, edges, spec, strict);
    const flow = (await repo.updateFlow(flowId, actor.workspaceId, {
      ...(input.name !== undefined && { name: input.name.trim() }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.spec !== undefined && { spec: input.spec }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.trigger !== undefined && { trigger: input.trigger }),
      ...(input.triggerConfig !== undefined && { triggerConfig: input.triggerConfig }),
      ...(input.nodes !== undefined && { nodes: normalizeFlowNodes(input.nodes) as never }),
      ...(input.edges !== undefined && { edges: normalizeFlowEdges(input.edges) as never }),
      ...(input.variables !== undefined && { variables: input.variables }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      updatedAt: new Date(),
    })) as Flow | undefined;
    if (!flow) throw notFound("Flow");
    await audit(repo, actor, "flow.update", flow);
    return { flow, warnings };
  });
  auditUser(actor, "flow.update", result.flow);
  return result;
}

export function validateFlowById(actor: FlowActor, flowId: string): Promise<ValidationIssue[]> {
  return withRepo(actor.workspaceId, async (repo) => {
    const flow = await requireFlow(repo, actor, flowId);
    return validateStoredFlow(flow.nodes, flow.edges, { spec: flow.spec });
  });
}

export function getFlowRun(actor: FlowActor, runId: string): Promise<{ run: FlowRun; steps: FlowRunStep[] }> {
  return withRepo(actor.workspaceId, async (repo) => {
    const run = await repo.findRun(runId, actor.workspaceId);
    if (!run) throw notFound("Run");
    return { run: run as FlowRun, steps: (await repo.listSteps(runId)) as FlowRunStep[] };
  });
}

export function listFlowRuns(actor: FlowActor, flowId: string, limit = 20): Promise<FlowRun[]> {
  const n = Math.min(100, Math.max(1, Math.trunc(Number(limit) || 20)));
  return withRepo(actor.workspaceId, async (repo) => {
    await requireFlow(repo, actor, flowId);
    return (await repo.listRuns(flowId, actor.workspaceId, n)) as FlowRun[];
  });
}

export function createFlowWebhook(actor: FlowActor, flowId: string, opts: { hmac?: boolean }): Promise<FlowWebhook> {
  return withRepo(actor.workspaceId, async (repo) => {
    await requireFlow(repo, actor, flowId);
    return (await repo.insertWebhook({
      id: createId(),
      flowId,
      workspaceId: actor.workspaceId,
      secret: crypto.randomBytes(24).toString("hex"),
      hmacKey: opts.hmac ? crypto.randomBytes(32).toString("hex") : null,
    })) as FlowWebhook;
  });
}

export function listFlowWebhooks(
  actor: FlowActor,
  flowId: string,
  { redact = false }: { redact?: boolean } = {}
): Promise<Array<FlowWebhook | RedactedFlowWebhook>> {
  return withRepo(actor.workspaceId, async (repo) => {
    await requireFlow(repo, actor, flowId);
    const rows = (await repo.listWebhooks(flowId, actor.workspaceId)) as FlowWebhook[];
    if (!redact) return rows;
    return rows.map((w) => ({ id: w.id, flowId: w.flowId, hmac: Boolean(w.hmacKey), createdAt: w.createdAt }));
  });
}

/** Public URL of a flow webhook. Falls back to a path when no base URL is configured. */
export function webhookUrl(secret: string): string {
  const base = (process.env["NEXT_PUBLIC_APP_URL"] ?? process.env["BETTER_AUTH_URL"] ?? "").replace(/\/+$/, "");
  return `${base}/api/webhooks/${secret}`;
}
```
Note on the test mock: `repo.audit` in the test receives the same `AuditEntryInput`; `actorUserId: null` and `meta.apiKeyId` are what it asserts. For the user path, the test's `logAudit` mock records the legacy shape.

- [ ] **Step 4: Run the service tests**

Run: `pnpm exec vitest run __tests__/flow-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Make the routes thin**

Add a shared mapper in `lib/flows/service.ts`:
```ts
export function serviceErrorResponse(e: unknown): Response {
  if (e instanceof FlowServiceError) {
    const status = { not_found: 404, invalid: 422, quota: 402, template_not_found: 404 }[e.code];
    const error = e.code === "not_found" ? "Not found" : e.message;
    return Response.json({ error, ...(e.issues ? { issues: e.issues } : {}) }, { status });
  }
  throw e;
}
```
Then, keeping each route's auth call and zod schema:
- `app/api/flows/route.ts`: `GET` → `const ws = await getCurrentWorkspace(); … return NextResponse.json(await listFlows({ kind: "user", workspaceId: ws.workspace.id, userId: ws.user.id }))` (use whatever user field `getCurrentWorkspace` returns; if it has none, switch the handler to `requireAuth()` like the others). `POST` → `createFlow(actor, parsed.data)` and return `NextResponse.json(flow, { status: 201 })`; `catch (e) { return serviceErrorResponse(e); }`. Add `spec: z.string().nullable().optional()` to `createFlowSchema`. Delete the imports that become unused.
- `app/api/flows/[id]/route.ts`: `GET` → `getFlow`; `PATCH` → `updateFlow(actor, id, parsed.data)` returning the flow; add `spec` to `updateFlowSchema`. Leave `DELETE` as it is.
- `app/api/flows/[id]/webhooks/route.ts`: `GET` → `listFlowWebhooks(actor, id)` (not redacted: the editor shows secrets today); `POST` → `createFlowWebhook(actor, id, { hmac: parsed.data.hmac })` with status 201. This adds the missing ownership check.
- `app/api/flow-runs/[id]/route.ts`: `GET` → `getFlowRun(actor, id)` returning `{ run, steps }`.
- `app/api/flows/[id]/runs/route.ts`: if it lists runs for a flow, use `listFlowRuns(actor, id, 50)` only if its current limit is 50; otherwise leave it unchanged.

Where the route used `ctx.user.id` and `ctx.workspace.id`, the actor is `{ kind: "user", workspaceId: ctx.workspace.id, userId: ctx.user.id }`.

- [ ] **Step 6: Verify**

Run:
```bash
pnpm exec vitest run __tests__/flow-service.test.ts
pnpm exec tsc --noEmit 2>&1 | tail -5
pnpm lint:tenant
```
Expected: PASS; no new type errors; the tenant lint passes (if it flags the repository's queries, they already filter by `workspaceId` — follow the lint's documented escape only if it has one, otherwise adjust the query shape it expects).

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/flows/service.ts apps/web/lib/flows/flow-repo.ts apps/web/__tests__/flow-service.test.ts apps/web/app/api/flows apps/web/app/api/flow-runs
git diff --cached
git commit -s -m "refactor(flows): move flow operations into a workspace-scoped service and check webhook ownership"
```

---

### Task 10: Flow tools over MCP

**Files:**
- Create: `apps/web/lib/mcp/flow-tools.ts`
- Create: `apps/web/__tests__/mcp-flow-tools.test.ts`
- Modify: `apps/web/lib/mcp/server.ts`

**Interfaces:**
- Consumes: everything exported by `@/lib/flows/service` (Task 9); `validateStoredFlow` (Task 7); `McpAuth`.
- Produces: `export interface McpToolDef` (now exported, with optional `scope?: "flows"`), `export function canWriteScope(auth: McpAuth, scope?: "flows"): boolean`, `FLOW_TOOLS: McpToolDef[]` registered in `TOOLS`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/__tests__/mcp-flow-tools.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const svc = vi.hoisted(() => ({
  listFlows: vi.fn(async () => [{ id: "f1", name: "One", status: "draft", nodes: [], edges: [] }]),
  getFlow: vi.fn(async () => ({ id: "f1", name: "One", description: null, spec: "## Purpose", status: "draft", enabled: false, trigger: "manual", nodes: [{ id: "n", purpose: "p" }], edges: [], variables: {}, version: 1 })),
  createFlow: vi.fn(async () => ({ flow: { id: "f2", name: "Two" }, warnings: [] })),
  updateFlow: vi.fn(async () => ({ flow: { id: "f1", name: "One" }, warnings: [{ level: "warning", message: "w" }] })),
  validateFlowById: vi.fn(async () => []),
  getFlowRun: vi.fn(async () => ({ run: { id: "r1", status: "succeeded" }, steps: [{ nodeId: "a" }, { nodeId: "b" }] })),
  listFlowRuns: vi.fn(async () => []),
  createFlowWebhook: vi.fn(async () => ({ id: "w1", secret: "s3cr3t", hmacKey: "k" })),
  listFlowWebhooks: vi.fn(async () => [{ id: "w1", flowId: "f1", hmac: true, createdAt: new Date(0) }]),
  webhookUrl: (s: string) => `https://example.com/api/webhooks/${s}`,
  FlowServiceError: class extends Error {
    constructor(public code: string, message: string, public issues?: unknown[]) { super(message); }
  },
}));
vi.mock("@/lib/flows/service", () => svc);
vi.mock("@/lib/mnemo/client", () => ({ getMnemoClient: vi.fn() }));

const auth = (scopes: string[]) => ({ workspaceId: "ws_a", keyId: "key_1", scopes });

beforeEach(() => Object.values(svc).forEach((f) => typeof f === "function" && "mockClear" in f && (f as { mockClear: () => void }).mockClear()));

describe("flow MCP tools", async () => {
  const { callMcpTool, listMcpTools } = await import("@/lib/mcp/server");
  const call = (name: string, args: Record<string, unknown>, scopes: string[] = []) => callMcpTool(name, args, auth(scopes));

  it("lists the new tools", () => {
    const names = listMcpTools().map((t) => t.name);
    for (const n of ["get_flow", "validate_flow", "create_flow", "update_flow", "get_flow_run", "list_flow_runs", "create_flow_webhook", "list_flow_webhooks"]) {
      expect(names).toContain(n);
    }
  });

  it.each([["readonly"], ["agents:read"], ["agents:write"]])("write tools refuse a key with only %s", async (scope) => {
    const r = await call("create_flow", { name: "x" }, [scope]);
    expect(r.isError).toBe(true);
    expect(svc.createFlow).not.toHaveBeenCalled();
  });

  it.each([[[]], [["write"]], [["flows:write"]]])("write tools accept scopes %j", async (scopes) => {
    const r = await call("create_flow", { name: "x" }, scopes);
    expect(r.isError).toBeFalsy();
    expect(svc.createFlow).toHaveBeenCalledWith(
      { kind: "apiKey", workspaceId: "ws_a", keyId: "key_1" },
      expect.objectContaining({ name: "x" }),
      { strict: true }
    );
  });

  it("returns validation issues when a write is rejected", async () => {
    svc.createFlow.mockRejectedValueOnce(new svc.FlowServiceError("invalid", "The flow has errors", [{ level: "error", message: "bad", nodeId: "z" }]));
    const r = await call("create_flow", { name: "x", nodes: [] });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("bad");
  });

  it("get_flow returns the spec and purposes", async () => {
    const r = await call("get_flow", { flowId: "f1" }, ["readonly"]);
    expect(r.structuredContent).toMatchObject({ spec: "## Purpose", nodes: [{ purpose: "p" }] });
  });

  it("get_flow_run returns ordered steps with a readonly key", async () => {
    const r = await call("get_flow_run", { runId: "r1" }, ["readonly"]);
    expect((r.structuredContent as { steps: Array<{ nodeId: string }> }).steps.map((s) => s.nodeId)).toEqual(["a", "b"]);
  });

  it("validate_flow accepts an unsaved graph", async () => {
    const r = await call("validate_flow", { nodes: [{ id: "z", type: "teleport", config: {} }], edges: [] }, ["readonly"]);
    expect((r.structuredContent as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
    expect(svc.validateFlowById).not.toHaveBeenCalled();
  });

  it("create_flow_webhook returns the URL once; list never returns secrets", async () => {
    const created = await call("create_flow_webhook", { flowId: "f1", hmac: true }, ["flows:write"]);
    expect(created.structuredContent).toMatchObject({ id: "w1", url: "https://example.com/api/webhooks/s3cr3t", hmacKey: "k" });
    const listed = await call("list_flow_webhooks", { flowId: "f1" }, ["readonly"]);
    expect(JSON.stringify(listed.structuredContent)).not.toContain("s3cr3t");
    expect(svc.listFlowWebhooks).toHaveBeenCalledWith(expect.anything(), "f1", { redact: true });
  });

  it("list_flows goes through the service", async () => {
    await call("list_flows", {}, ["readonly"]);
    expect(svc.listFlows).toHaveBeenCalled();
  });

  it("run_flow points callers at get_flow_run", () => {
    const run = listMcpTools().find((t) => t.name === "run_flow")!;
    expect(run.description).toContain("get_flow_run");
  });
});
```

- [ ] **Step 2: Run and see them fail**

Run: `pnpm exec vitest run __tests__/mcp-flow-tools.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `lib/mcp/server.ts`:
- `export interface McpToolDef` and add `scope?: "flows";`;
- add below `canWrite`:
```ts
/**
 * Flow tools use a stricter rule than `canWrite`: an `agents:write` key must
 * not be able to edit flows. Unscoped keys keep their legacy full access.
 */
export function canWriteScope(auth: McpAuth, scope?: "flows"): boolean {
  if (!scope) return canWrite(auth);
  if (auth.scopes.includes("readonly")) return false;
  if (auth.scopes.length === 0) return true;
  return auth.scopes.includes("write") || auth.scopes.includes(`${scope}:write`);
}
```
- in `callMcpTool`, replace `!canWrite(auth)` with `!canWriteScope(auth, tool.scope)`;
- replace the `list_flows` handler body with `const { listFlows } = await import("@/lib/flows/service"); const rows = await listFlows(actorOf(auth)); return { flows: rows.map(({ id, name, status }) => ({ id, name, status })) };`, importing `actorOf` from `./flow-tools`;
- set the `run_flow` description to: `"Encola un flujo del workspace con un input opcional y devuelve { runId, status }. Consultá el resultado con get_flow_run."`;
- `import { FLOW_TOOLS, actorOf } from "./flow-tools";` and end the `TOOLS` array with `...FLOW_TOOLS,`. `flow-tools.ts` imports only **types** from `server.ts` (`import type`), so there is no runtime cycle.

Create `lib/mcp/flow-tools.ts`:
```ts
import "server-only";
import type { McpAuth, McpToolDef } from "./server";

export const actorOf = (auth: McpAuth) => ({
  kind: "apiKey" as const,
  workspaceId: auth.workspaceId,
  keyId: auth.keyId,
});

const svc = () => import("@/lib/flows/service");

/** Service errors reach the MCP client as a readable message with the issues. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const { FlowServiceError } = await svc();
    if (e instanceof FlowServiceError && e.issues?.length) {
      throw new Error(`${e.message}: ${e.issues.map((i) => `${i.nodeId ? `[${i.nodeId}] ` : ""}${i.message}`).join("; ")}`);
    }
    throw e;
  }
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v) throw new Error(`${name} is required`);
  return v;
};

const graphProps = {
  nodes: { type: "array", items: { type: "object" }, description: "Stored nodes: { id, type, label, config, position, purpose }." },
  edges: { type: "array", items: { type: "object" }, description: "{ id, source, target, sourceHandle? }. try_catch uses try/catch/done; parallel uses done." },
  variables: { type: "object" },
  spec: { type: ["string", "null"], description: "Markdown: Purpose, Trigger, Steps, Side effects, Failure handling, Dependencies." },
  description: { type: ["string", "null"] },
};

function pickInput(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of ["name", "description", "spec", "nodes", "edges", "variables", "status", "enabled"]) {
    if (input[k] !== undefined) out[k] = input[k];
  }
  return out;
}

export const FLOW_TOOLS: McpToolDef[] = [
  {
    name: "get_flow",
    title: "Get a flow",
    description: "Devuelve un flujo completo: spec, pasos (con su propósito), conexiones, variables y estado.",
    access: "read",
    inputSchema: { type: "object", properties: { flowId: { type: "string" } }, required: ["flowId"] },
    async handler(input, auth) {
      const f = await (await svc()).getFlow(actorOf(auth), str(input.flowId, "flowId"));
      const { id, name, description, spec, status, enabled, trigger, nodes, edges, variables, version } = f;
      return { id, name, description, spec, status, enabled, trigger, nodes, edges, variables, version };
    },
  },
  {
    name: "validate_flow",
    title: "Validate a flow",
    description: "Valida un flujo guardado (flowId) o un grafo sin guardar ({ nodes, edges, spec }). Devuelve errores y avisos.",
    access: "read",
    inputSchema: { type: "object", properties: { flowId: { type: "string" }, ...graphProps } },
    async handler(input, auth) {
      if (typeof input.flowId === "string" && input.flowId) {
        return { issues: await (await svc()).validateFlowById(actorOf(auth), input.flowId) };
      }
      const { validateStoredFlow } = await import("@/lib/flows/validate-stored");
      return {
        issues: validateStoredFlow(input.nodes ?? [], input.edges ?? [], {
          spec: typeof input.spec === "string" ? input.spec : null,
        }),
      };
    },
  },
  {
    name: "create_flow",
    title: "Create a flow",
    description: "Crea un flujo. Rechaza grafos con errores y devuelve los problemas; los avisos vuelven junto al flujo.",
    access: "write",
    scope: "flows",
    inputSchema: { type: "object", properties: { name: { type: "string" }, ...graphProps }, required: ["name"] },
    async handler(input, auth) {
      const name = str(input.name, "name");
      return guard(async () => (await svc()).createFlow(actorOf(auth), { ...pickInput(input), name }, { strict: true }));
    },
  },
  {
    name: "update_flow",
    title: "Update a flow",
    description: "Actualiza campos de un flujo (parcial). Rechaza grafos con errores.",
    access: "write",
    scope: "flows",
    inputSchema: {
      type: "object",
      properties: {
        flowId: { type: "string" },
        name: { type: "string" },
        status: { type: "string", enum: ["draft", "active", "paused"] },
        enabled: { type: "boolean" },
        ...graphProps,
      },
      required: ["flowId"],
    },
    async handler(input, auth) {
      const flowId = str(input.flowId, "flowId");
      return guard(async () => (await svc()).updateFlow(actorOf(auth), flowId, pickInput(input), { strict: true }));
    },
  },
  {
    name: "get_flow_run",
    title: "Get a flow run",
    description:
      "Estado, entrada, salida y error de una corrida, con sus pasos en orden. Los pasos guardan entradas y salidas tal cual: pueden contener datos sensibles del flujo.",
    access: "read",
    inputSchema: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"] },
    async handler(input, auth) {
      return (await svc()).getFlowRun(actorOf(auth), str(input.runId, "runId"));
    },
  },
  {
    name: "list_flow_runs",
    title: "List flow runs",
    description: "Últimas corridas de un flujo, sin pasos. Default 20, máximo 100.",
    access: "read",
    inputSchema: { type: "object", properties: { flowId: { type: "string" }, limit: { type: "number" } }, required: ["flowId"] },
    async handler(input, auth) {
      const runs = await (await svc()).listFlowRuns(actorOf(auth), str(input.flowId, "flowId"), Number(input.limit ?? 20));
      return { runs };
    },
  },
  {
    name: "create_flow_webhook",
    title: "Create a flow webhook",
    description:
      "Crea un webhook para el flujo y devuelve su URL. Es la única vez que se devuelve el secreto: guardalo donde corresponda.",
    access: "write",
    scope: "flows",
    inputSchema: { type: "object", properties: { flowId: { type: "string" }, hmac: { type: "boolean" } }, required: ["flowId"] },
    async handler(input, auth) {
      const s = await svc();
      const w = await s.createFlowWebhook(actorOf(auth), str(input.flowId, "flowId"), { hmac: input.hmac === true });
      return { id: w.id, url: s.webhookUrl(w.secret), ...(w.hmacKey ? { hmacKey: w.hmacKey } : {}) };
    },
  },
  {
    name: "list_flow_webhooks",
    title: "List flow webhooks",
    description: "Webhooks de un flujo: id, fecha y si usa HMAC. Nunca devuelve secretos.",
    access: "read",
    inputSchema: { type: "object", properties: { flowId: { type: "string" } }, required: ["flowId"] },
    async handler(input, auth) {
      return { webhooks: await (await svc()).listFlowWebhooks(actorOf(auth), str(input.flowId, "flowId"), { redact: true }) };
    },
  },
];
```

- [ ] **Step 4: Run and verify**

Run: `pnpm exec vitest run __tests__/mcp-flow-tools.test.ts && pnpm exec tsc --noEmit 2>&1 | tail -5`
Expected: PASS; no new type errors. If `import type` from `./server` still creates a cycle warning, move `McpAuth`/`McpToolDef` into `lib/mcp/types.ts` and import from there in both files.

- [ ] **Step 5: Document the tools**

Find where the MCP server is documented (`grep -rn "run_flow" docs README.md`) and add the eight tools with one line each, the `flows:write` scope rule, and the note that `create_flow_webhook` is the only call that returns a secret.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/mcp apps/web/__tests__/mcp-flow-tools.test.ts docs README.md
git diff --cached
git commit -s -m "feat(mcp): build, validate and debug flows with a workspace api key"
```

---

### Task 11: Documentation panel and step purpose in the editor

**Files:**
- Create: `apps/web/components/flows/FlowDocsPanel.tsx`
- Create: `apps/web/components/flows/FlowDocsPanel.test.tsx`
- Modify: `apps/web/components/flows/FlowBuilder.tsx`
- Modify: `apps/web/components/flows/inspector/InspectorForm.tsx`
- Modify: `apps/web/app/[locale]/[workspaceSlug]/(shell)/flows/[id]/page.tsx` (or wherever `FlowDTO` is built — find it with `grep -rn "FlowBuilder" apps/web/app`)
- Modify: `apps/web/messages/es.json`, `en.json`, `pt.json`
- Create: `apps/web/components/flows/node-mapping.ts`
- Create: `apps/web/components/flows/node-mapping.test.ts`

**Interfaces:**
- Consumes: `PURPOSE_MAX` (Task 6), `validateFlow(…, docs)` (Task 7), `PATCH /api/flows/[id]` accepting `spec` (Task 9).
- Produces: `FlowDTO.spec?: string | null`, `FlowDTO.nodes[].purpose?: string`; from `components/flows/node-mapping.ts`: `StoredNodeDTO`, `deriveNodeId(n)`, `subtitleFor(n)`, `toCanvasNode(n): Node`, `toStoredNode(n: Node): StoredNodeDTO`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/components/flows/node-mapping.test.ts
import { describe, it, expect } from "vitest";
import { toCanvasNode, toStoredNode } from "./node-mapping";

describe("purpose survives load → edit → save", () => {
  it("round-trips", () => {
    const stored = { id: "a", type: "transform", label: "A", config: { template: "{}" }, position: { x: 1, y: 2 }, purpose: "Shape data" };
    const canvas = toCanvasNode(stored);
    expect((canvas.data as { purpose?: string }).purpose).toBe("Shape data");
    const edited = { ...canvas, data: { ...canvas.data, purpose: "Build the payload" } };
    expect(toStoredNode(edited)).toEqual({ ...stored, purpose: "Build the payload" });
  });
  it("omits an empty purpose", () => {
    const canvas = toCanvasNode({ id: "a", type: "note", label: "A", config: {}, position: { x: 0, y: 0 } });
    expect(toStoredNode(canvas)).not.toHaveProperty("purpose");
  });
});
```

```tsx
// apps/web/components/flows/FlowDocsPanel.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
import { FlowDocsPanel, SPEC_TEMPLATE } from "./FlowDocsPanel";

describe("FlowDocsPanel", () => {
  it("offers the template for an empty spec", () => {
    const onChange = vi.fn();
    render(<FlowDocsPanel spec="" onChange={onChange} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "useTemplate" }));
    expect(onChange).toHaveBeenCalledWith(SPEC_TEMPLATE);
  });
  it("edits and previews without rendering raw HTML", () => {
    const onChange = vi.fn();
    render(<FlowDocsPanel spec={"## Purpose\n<img src=x onerror=alert(1)>"} onChange={onChange} onClose={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "## Steps" } });
    expect(onChange).toHaveBeenCalledWith("## Steps");
    fireEvent.click(screen.getByRole("button", { name: "preview" }));
    expect(screen.getByRole("heading", { name: "Purpose" })).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});
```

- [ ] **Step 2: Run and see them fail**

Run: `pnpm exec vitest run components/flows/node-mapping.test.ts components/flows/FlowDocsPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `FlowDocsPanel`**

No markdown library is installed and none is added: the preview renders a small, safe subset (headings, list items, paragraphs) as React text nodes — never `dangerouslySetInnerHTML`.
```tsx
// apps/web/components/flows/FlowDocsPanel.tsx
"use client";
import { useState } from "react";
import { BookText, X } from "lucide-react";
import { useTranslations } from "next-intl";

export const SPEC_TEMPLATE = [
  "## Purpose",
  "",
  "## Trigger",
  "",
  "## Steps",
  "",
  "## Side effects",
  "",
  "## Failure handling",
  "",
  "## Dependencies",
  "",
].join("\n");

function Preview({ text }: { text: string }) {
  const blocks = text.split("\n");
  return (
    <div className="space-y-1 text-xs text-body">
      {blocks.map((line, i) => {
        const h = /^(#{1,3})\s+(.*)$/.exec(line);
        if (h) {
          const Tag = (`h${h[1]!.length + 2}` as "h3" | "h4" | "h5");
          return <Tag key={i} className="mt-2 font-semibold text-strong">{h[2]}</Tag>;
        }
        const li = /^\s*[-*]\s+(.*)$/.exec(line);
        if (li) return <li key={i} className="ml-4 list-disc">{li[1]}</li>;
        return line.trim() ? <p key={i}>{line}</p> : null;
      })}
    </div>
  );
}

export function FlowDocsPanel({
  spec,
  onChange,
  onClose,
}: {
  spec: string;
  onChange: (next: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("pages.flows.docs");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  return (
    <aside className="absolute right-0 top-0 z-20 flex h-full w-[380px] flex-col border-l border-line bg-surface">
      <header className="flex items-center justify-between border-b border-line px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-medium text-strong">
          <BookText className="h-3.5 w-3.5" /> {t("title")}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setMode("edit")} className="rounded px-2 py-1 text-[11px] hover:bg-hover">
            {t("edit")}
          </button>
          <button type="button" onClick={() => setMode("preview")} className="rounded px-2 py-1 text-[11px] hover:bg-hover">
            {t("preview")}
          </button>
          <button type="button" onClick={onClose} aria-label={t("close")} className="rounded p-1 hover:bg-hover">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-3">
        {!spec.trim() && (
          <button
            type="button"
            onClick={() => onChange(SPEC_TEMPLATE)}
            className="mb-2 rounded-lg border border-line px-2.5 py-1.5 text-xs hover:bg-hover"
          >
            {t("useTemplate")}
          </button>
        )}
        {mode === "edit" ? (
          <textarea
            value={spec}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t("placeholder")}
            className="h-full min-h-[400px] w-full resize-none rounded-lg border border-line bg-elevated p-2 font-mono text-xs text-strong outline-none focus:border-violet-500/60"
          />
        ) : (
          <Preview text={spec} />
        )}
      </div>
    </aside>
  );
}
```
The test clicks buttons by accessible name; the mocked `t` returns the key, so the names are `useTemplate` and `preview`.

- [ ] **Step 4: Wire the builder**

In `FlowBuilder.tsx`:
- extend `FlowDTO`: `spec?: string | null;` and `purpose?: string;` on node items;
- move `deriveNodeId` (line ~86) and `subtitleFor` (line ~1252) out of `FlowBuilder.tsx` into a new pure module, and add the mappers there. `FlowBuilder.tsx` imports them; its test-heavy dependencies (xyflow runtime, router, intl) stay out of the unit test:
```ts
// apps/web/components/flows/node-mapping.ts
import type { Node } from "@xyflow/react";

export interface StoredNodeDTO {
  id: string;
  type: string;
  label: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
  purpose?: string;
}

export function deriveNodeId(n: { type: string; config?: Record<string, unknown> }): string {
  // (moved unchanged from FlowBuilder.tsx)
}

export function subtitleFor(n: { type: string; config?: Record<string, unknown> | undefined }): string {
  // (moved unchanged from FlowBuilder.tsx)
}

export function toCanvasNode(n: StoredNodeDTO): Node {
  return {
    id: n.id,
    type: n.type,
    position: n.position,
    data: {
      label: n.label,
      subtitle: subtitleFor(n),
      config: n.config,
      nodeId: deriveNodeId(n),
      ...(n.purpose ? { purpose: n.purpose } : {}),
    },
  };
}

export function toStoredNode(n: Node): StoredNodeDTO {
  const d = n.data as { label: string; config?: Record<string, unknown>; purpose?: string };
  return {
    id: n.id,
    type: n.type as string,
    label: d.label,
    config: d.config ?? {},
    position: n.position,
    ...(d.purpose?.trim() ? { purpose: d.purpose.trim() } : {}),
  };
}
```
  Copy the bodies of `deriveNodeId` and `subtitleFor` verbatim from `FlowBuilder.tsx` (the comments above mark where). In `FlowBuilder.tsx`, `FlowDTO["nodes"]` becomes `StoredNodeDTO[]`, the initializer becomes `normalizeFlowNodes(flow.nodes).map(toCanvasNode)`, and `buildPayload` uses `nodes: nodes.map(toStoredNode)`.
- add `const [spec, setSpec] = useState(flow.spec ?? "");` and `const [docsOpen, setDocsOpen] = useState(false);`;
- include `spec` in `buildPayload` (`spec: spec || null`) and in the auto-save effect's dependency list (`[nodes, edges, variables, spec]`);
- add a toolbar button before the variables button, following the existing buttons:
```tsx
            <button
              type="button"
              onClick={() => setDocsOpen((o) => !o)}
              className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-body hover:bg-hover"
              title={t("documentation")}
            >
              <BookText className="h-3.5 w-3.5" />
            </button>
```
  and render `{docsOpen && <FlowDocsPanel spec={spec} onChange={setSpec} onClose={() => setDocsOpen(false)} />}` next to `<FlowRunsPanel … />`;
- pass the docs to validation: `validateFlow` is called at two places (~line 508, the canvas badges, and ~line 965 inside `ValidationPanel`). Add `{ spec }` as the fourth argument in both; give `ValidationPanel` a `spec: string` prop and pass it from the builder. Node `data.purpose` already travels in `data`.

In the page that builds `FlowDTO` from the DB row, pass `spec: row.spec` through.

In `InspectorForm.tsx`, extend the `data` type with `purpose?: string`, let `update` accept `purpose`, and add below the name input:
```tsx
      <FieldLabel label={t("purposeLabel")} help={t("purposeHelp")} />
      <input
        value={String(data.purpose ?? "")}
        maxLength={PURPOSE_MAX}
        onChange={(e) => update({ purpose: e.target.value.replace(/[\r\n]+/g, " ") })}
        placeholder={t("purposePlaceholder")}
        className="mb-3 w-full rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-strong outline-none focus:border-violet-500/60"
      />
```
with `update` spreading `...(patch.purpose !== undefined ? { purpose: patch.purpose } : {})` into `data`, and `import { PURPOSE_MAX } from "@/lib/flows/normalize";`.

Messages — add to each locale file:
- `pages.flows.builder.documentation`: es "Documentación", en "Documentation", pt "Documentação".
- `pages.flows.docs`: `title` (Documentación del flujo / Flow documentation / Documentação do fluxo), `edit` (Editar / Edit / Editar), `preview` (Vista previa / Preview / Pré-visualização), `close` (Cerrar / Close / Fechar), `useTemplate` (Usar plantilla / Use template / Usar modelo), `placeholder` (Qué hace este flujo, qué lo dispara, qué escribe afuera y qué pasa si falla. / What this flow does, what starts it, what it writes elsewhere and what happens when it fails. / O que este fluxo faz, o que o dispara, o que ele escreve fora e o que acontece se falhar.).
- `pages.flows.inspector`: `purposeLabel` (Para qué está este paso / What this step is for / Para que serve este passo), `purposeHelp` (Una línea. Ayuda a personas y agentes a entender el flujo sin abrir cada paso. / One line. Helps people and agents understand the flow without opening every step. / Uma linha. Ajuda pessoas e agentes a entender o fluxo sem abrir cada passo.), `purposePlaceholder` (Ej.: busca la tarea del incidente en Odoo / e.g. finds the incident's task / Ex.: busca a tarefa do incidente).

The incident example in `purposePlaceholder` must stay generic: no customer names.

- [ ] **Step 5: Run and verify**

Run:
```bash
pnpm exec vitest run components/flows
pnpm exec tsc --noEmit 2>&1 | tail -5
pnpm lint 2>&1 | tail -10
```
Expected: PASS; no new type or lint errors. If an i18n key-parity test exists (`grep -rln "messages" __tests__`), it must pass too.

- [ ] **Step 6: See it working**

Start the app the way the repo documents (`pnpm dev` from the root with a local Postgres from `docker-compose.yml`, after `pnpm db:migrate`), open a flow, write a spec, set a purpose, reload, and confirm both persisted and the validation panel shows the two warnings when they are empty. If a local database is not available, say so in the task report instead of claiming this step.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/flows apps/web/messages "apps/web/app/[locale]"
git diff --cached
git commit -s -m "feat(flows): document flows and steps from the editor"
```

---

### Task 12: Final verification and PR preparation

**Files:** none new.

- [ ] **Step 1: Full checks**

Run from the repo root:
```bash
pnpm --filter web exec tsc --noEmit
pnpm --filter web test
pnpm --filter web lint:tenant
bash scripts/audit-invariants.sh
```
Expected: type-check and tenant lint clean; the test run has no failures beyond the Task 1 baseline (list any baseline failures explicitly); audit-invariants passes.

- [ ] **Step 2: Sign off the spec commits made before this plan**

The three spec commits on this branch were made without `-s`. Run:
```bash
git rebase --signoff origin/main
git log --format='%h %s%n%(trailers:key=Signed-off-by)' origin/main..HEAD
```
Expected: every commit shows a `Signed-off-by` trailer.

- [ ] **Step 3: Secret and identifier scan**

Run:
```bash
git diff origin/main..HEAD | grep -niE "fichap|odoo\.com|newrelic\.com/[0-9]|@[a-z0-9-]+\.(com|io)|ok_live_[a-z0-9]{8,}" || echo "clean"
gitleaks git --log-opts="origin/main..HEAD" --no-banner
```
Expected: `clean` (the `api.newrelic.com` endpoint and `example.com` are fine; anything else gets removed) and no gitleaks findings.

- [ ] **Step 4: Report**

Summarize for the human: commits, test counts versus baseline, anything skipped (e.g. the manual editor check), and the rollout note from the spec (apply `0055_flow_spec.sql` with `apply-sql-migrations.mjs` before switching the image). Do not push or open the PR without the human's go-ahead.
