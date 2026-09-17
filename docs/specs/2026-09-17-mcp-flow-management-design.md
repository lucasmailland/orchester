# Flow management over MCP, documented flows, and two engine primitives

Date: 2026-09-17 · Status: approved design, revised after adversarial review, pending implementation

## Problem

An API key can list flows (`GET /api/v1/flows`, MCP `list_flows`) and enqueue a run (MCP `run_flow`),
but nothing else. Creating, editing, validating a flow, creating its webhook and reading a run's
result all require a browser session (`requireAuth`). Two concrete consequences:

1. `run_flow` returns a `runId` and its own comment tells the caller to poll `/api/flow-runs/:runId`,
   but that route rejects API keys. An MCP client can start a flow and never learn how it ended.
2. A flow cannot be built, tested and iterated by an agent. Every change goes through the editor.

A flow also has no place for a real explanation of what it does. `flow.description` is a short
free-text column shown only in the flows list; the editor does not edit it and `flow_version` does
not snapshot it. The `note` node is a canvas comment.

Finally, two things that ordinary integration flows need cannot be expressed without enabling
`code` steps, which are disabled by default (`FLOW_CODE_EXECUTION`) and must stay disabled wherever
the process environment holds secrets:

- **Retrying** a failing external call. `try_catch` catches once and the run continues; it never retries.
- **Deriving a value** from a variable: `{{…}}` interpolation only substitutes, so "a timestamp minus
  15 minutes" or "the first 8 characters of an id" are impossible.

## Goals

- An MCP client with a workspace API key can create, read, update and validate a flow, create its
  webhook, and read the result of its runs.
- A flow carries a long-form, versioned specification, and each step can state its purpose.
- Steps that call external systems can retry with backoff, and interpolation can derive simple values,
  without executing user code.

## Non-goals

- Deleting flows over MCP.
- A dry-run execution mode.
- An agent that checks a flow against its spec (enabled by this work, built later).
- Resuming a failed run from the failed step. Recovery is a new run; flows that need it must make
  their writes idempotent.
- A join/barrier step after `parallel`.

## Design

### 1. Shared flow service

Move the logic inside the flow route handlers into `apps/web/lib/flows/service.ts`, and make both the
routes and the MCP tools call it. The service takes an explicit actor:

```ts
type FlowActor =
  | { kind: "user"; workspaceId: string; userId: string }
  | { kind: "apiKey"; workspaceId: string; keyId: string };
```

Functions: `getFlow`, `createFlow`, `updateFlow`, `validateStoredFlow`, `getFlowRun`, `listFlowRuns`,
`createFlowWebhook`, `listFlowWebhooks`. Each one:

- runs inside a transaction that sets `app.workspace_id` (and `app.user_id` for users), and always
  filters by `workspaceId` too;
- **loads the parent flow filtered by workspace before touching a child row**. Today
  `POST /api/flows/[id]/webhooks` inserts with the path's `flowId` without checking who owns that flow;
  the service fixes that for both the route and MCP;
- keeps today's behaviour: plan quota on create, `normalizeFlowNodes` / `normalizeFlowEdges` on write,
  template resolution on create;
- writes audit entries through `appendAuditSync` (the non-deprecated path) with
  `actorKind: "api_key"` and the key id in the entry for API keys, `actorKind: "user"` and `userId` for
  users. For API-key writes a failed audit write fails the operation — an agent's change must never be
  unattributed. User writes keep today's fire-and-forget behaviour.

Route handlers become thin: auth, body parsing, service call, response mapping. Their tests must pass
unchanged, except where they encode the missing ownership check.

### 2. Validation of stored flows

`validateFlow` reads the editor shape (`data.nodeId`, `data.config`), while flows are stored flat
(`{ id, type, label, config, position, purpose? }`). `validateStoredFlow(nodes, edges)`:

1. rejects any raw node whose `type` is not an engine type or a known legacy type **before**
   normalization — normalization silently turns unknown types into `note` steps, which would hide the
   mistake from an agent;
2. normalizes;
3. maps each stored node to the `VNode` shape (`data.nodeId` from the same derivation the editor uses,
   `data.config` from `config`) and runs `validateFlow`.

### 3. New MCP tools (`apps/web/lib/mcp/server.ts`)

| Tool | Access | Input | Output |
|---|---|---|---|
| `get_flow` | read | `flowId` | name, description, spec, status, enabled, trigger, nodes (with `purpose`), edges, variables, version |
| `validate_flow` | read | `flowId` **or** `{nodes, edges}` | `{ issues: [{level, message, nodeId?}] }` |
| `create_flow` | write | `name`, `description?`, `spec?`, `nodes?`, `edges?`, `variables?` | the created flow + warnings |
| `update_flow` | write | `flowId` + any of `name`, `description`, `spec`, `nodes`, `edges`, `variables`, `status`, `enabled` | the updated flow + warnings |
| `get_flow_run` | read | `runId` | run (status, input, output, error, timestamps) and its steps in order |
| `list_flow_runs` | read | `flowId`, `limit?` (default 20, max 100) | runs, newest first, without steps |
| `create_flow_webhook` | write | `flowId`, `hmac?` | webhook id, full URL, HMAC key if requested |
| `list_flow_webhooks` | read | `flowId` | webhook ids, created dates, whether HMAC is on — **never** secrets |

Rules:

- **Authorization.** Write tools require the key to be unscoped (legacy full access), or to hold
  `write` or `flows:write`. Today's `canWrite` accepts any `*:write` scope, so an `agents:write` key could
  edit flows; the flow tools use the stricter check. `readonly` always refuses.
- `create_flow` / `update_flow` run `validateStoredFlow` and **reject** the write on any error-level
  issue, returning the issues. Warnings come back with the saved flow. An empty graph stays allowed.
  This is stricter than the editor on purpose.
- An id from another workspace returns the same "not found" as a missing id.
- `create_flow_webhook` is the only place a secret is returned. The session route
  `GET /api/flows/[id]/webhooks` keeps returning secrets to the editor (unchanged); `list_flow_webhooks`
  redacts them.
- `list_flows` moves onto the service; it currently queries without setting `app.workspace_id`.
- `run_flow`'s description points at `get_flow_run`.
- `get_flow_run` returns step inputs and outputs as stored. They can hold sensitive data from the flow's
  variables; the tool description says so, and flows that handle such data should not echo it into
  variables they do not need.

### 4. Flow specification and step purpose

**Data model** (migration generated with `drizzle-kit generate`, applied by `migrate`):

- `flow.spec text` — markdown, nullable.
- `flow_version.spec text` — snapshotted with the graph when a version is created, restored with it.
- Step purpose is a top-level field of the stored node: `purpose?: string`, one line, at most 280
  characters. No migration.

**Round-trip.** `normalizeFlowNodes` keeps `purpose` (truncating past 280). The editor carries it
through load (`data.purpose`) and save (`buildPayload`), which today rebuild nodes field by field and
would drop it.

**Suggested spec template** (offered for an empty spec; headings are not enforced):

```markdown
## Purpose
## Trigger
## Steps
## Side effects
## Failure handling
## Dependencies
```

**Editor.** A "Documentation" tab with a markdown editor and preview, saved with the flow, and a
"Purpose" single-line field at the top of every node's inspector.

**Validation.** Two new `warning`-level checks, never errors: nodes but no spec; a non-trigger,
non-note step without purpose.

### 5. Retry on external steps

`integration` and `http` steps gain an optional config block:

```json
{ "retry": { "attempts": 3, "backoffMs": 1000, "maxBackoffMs": 30000 } }
```

- `attempts` is the total number of tries (1–5, default 1 = today's behaviour). Delay doubles from
  `backoffMs`, capped at `maxBackoffMs`, with jitter.
- `integration` retries when the action throws. `http` retries on network errors, 429 and 5xx; other
  statuses return as today.
- `http` gains `failOnStatus: boolean` (default `false`, today's behaviour). When true, a non-2xx final
  response fails the step, so `try_catch` can see it.
- Each attempt is visible in the step's output (`attempts`, last error). The run fails only after the
  last attempt.
- Retries repeat the external call, so the flow author is responsible for idempotency. The field's help
  text says so.

### 6. Interpolation filters

`{{ path | filter:arg:arg }}`, applied left to right. Pure functions, no user code, unknown filter =
error at validation time and at run time.

| Filter | Example | Result |
|---|---|---|
| `addMinutes:n` | `{{activatedAt \| addMinutes:-15}}` | epoch ms shifted by n minutes (accepts epoch ms or ISO) |
| `toEpochMs` / `toIso` | `{{closedAt \| toIso}}` | conversion |
| `slice:start:end` | `{{issueId \| slice:0:8}}` | substring |
| `lower` / `upper` / `trim` | | |
| `default:value` | `{{priority \| default:unknown}}` | fallback for missing or empty |
| `json` | `{{error \| json}}` | JSON string, for embedding in a body |
| `nrql` | `{{appName \| nrql}}` | escaped for a NRQL string literal (reuses `nrqlEscape`) |
| `redact:maxLen` | `{{message \| redact:500}}` | masks emails, bearer/API tokens, JWTs and digit runs of 8+, then truncates to `maxLen` |

Filters apply in `interpolate`, `resolveValue` and `deepInterpolate`. `validateStoredFlow` parses every
template in node configs and reports unknown filters and bad arguments as errors.

## Testing (Vitest, test first)

- `service.test.ts`: workspace isolation on every function (including a webhook for a foreign flow);
  quota refusal; normalization applied; audit entry with the right actor kind; API-key write fails when
  the audit write fails.
- MCP tools: write tools refuse `readonly`, `*:read`-only and `agents:write`-only keys and accept
  `flows:write`; create/update reject error-level graphs and unknown raw types; `get_flow_run` returns
  ordered steps; `list_flow_webhooks` never returns a secret.
- `validateStoredFlow`: flat stored nodes validate the same as editor nodes; unknown types rejected.
- `purpose`: survives normalization (truncated past 280) and an editor load → edit → save round-trip.
- Versions: create and restore carry `spec`.
- Retry: attempts count, backoff schedule (fake timers), which statuses retry, `failOnStatus`, final
  failure propagates through `try_catch`.
- Filters: each filter (for `redact`: emails, tokens, JWTs, long digit runs, truncation), chaining, bad arguments, unknown filter, and that a template without filters
  interpolates exactly as before.
- Existing route and engine tests keep passing.

## Rollout

One PR to `main`, with no deployment-specific identifiers. The migration adds two nullable columns and
is safe to apply before the new image starts. Deploy from the merged `main` commit and confirm the
columns exist before switching the image. All new engine behaviour is opt-in per step, so existing flows
run unchanged.

## Risks

- **Moving route logic** can change behaviour silently. The route tests run before and after the move,
  and the move lands before any tool uses the service.
- **Agents writing flows** in a shared workspace: stricter scope check, validation on write, attributed
  audit, no delete tool.
- **Retries duplicating writes** in external systems: opt-in, documented, and flows are expected to
  check before writing.
- **Migration not applied** in a manually deployed environment breaks flow queries: the rollout checks it.
