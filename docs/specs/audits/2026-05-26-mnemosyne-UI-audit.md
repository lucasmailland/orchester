# Mnemosyne v1.6 UI audit — 2026-05-26

**Auditor**: read-only manual QA pass over every UI surface that ships
with Mnemosyne v1.6. The job: walk each page, trace every wire from
JSX → SWR hook → API route → DB, and flag everything that is mocked,
hardcoded, mismatched, or otherwise not actually backed by real data.

**Working tree**: `/Users/lucasmailland/dev/orchester` @ `6942a4a` on
branch `mnemo-v1.4-graph-rem-tom`. Dev server: `http://localhost:3333`.
Demo workspace: `tvlds3k623us6sz7zp2ek6gh` (acme-inc). Seeded facts: 12
rows matching `mfact_smoke%` with full v1.6 cognitive payload
(memory_type, attributed_to, actor_id, protocol_version).

**Access constraint**: the brief warned auth is unreachable via the
Chrome MCP because `BETTER_AUTH_URL` points to `:3000` while dev runs
on `:3333`. I also tried inserting a `session` row directly and
hitting routes with `Cookie: better-auth.session_token=...` — better-
auth signs cookies with `BETTER_AUTH_SECRET` so a hand-crafted token
never validates (every authenticated curl returned `401 Unauthorized`).
That blocks one wing of the brief (end-to-end mutation checks via
curl), but the heavier wing — code inspection of every page, hook,
and route + DB schema checks — went ahead cleanly and uncovered
plenty of hard wiring defects without needing the cookie.

---

## Executive summary

| Severity            | Count | Headline                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔴 HARD findings    | **6** | `health/latest` response shape mismatch silently zeroes every KPI; `useBrainFact` queries an `id` filter the server doesn't honour, so `/brain/[factId]` loads the wrong fact; `/brain/review` route is linked but doesn't exist (404); citations endpoint shape mismatch; export route ignores `format` + `kind` + `scope`; v1.6 cognitive payload is invisible in the UI. |
| 🟠 Wired-but-broken | **5** | Health history `snapshotAt` vs `capturedAt` mismatch; KPI strip reads `factCountTotal` / `factCountPinned` / `factCountForgotten` columns that don't exist on the snapshot; settings GET returns object the UI then casts as if flat; Undo endpoint `/api/mnemo/audit` doesn't exist; `mnemo_health` table is empty in dev (no cron has run).                               |
| 🟡 Soft             | **4** | 7th cron button ("summary-refresh") is a dashed stub; recall-quality toggle strings are not in i18n catalog; episodes endpoint exists but no UI consumer; entities endpoint exists but no UI consumer.                                                                                                                                                                      |

**TL;DR**: The Mnemosyne UI compiles, renders, and never throws — but
**5 of 11 surfaces are statically rendering placeholder zeros** because
their data fetch returns an object the consumer treats as a different
shape. The Inspector list itself is fine (it talks to a real route
that returns real rows). Everything else is window-dressing in v1.6.

**Score**: average **5.4 / 10** across 11 surfaces. Three surfaces
score 9–10 (Inspector list, Fact mutations, Sensitivity toggle); five
score 4–6 (KPI strip, Detail page, Health charts, Citations, Export);
two score 1–3 (Undo, Review queue link); one is N/A (entities — no UI).

---

## Severity legend

- 🔴 **HARD finding** — broken in production. UI looks fine but the
  numbers, links, or actions don't actually do what the JSX claims.
- 🟠 **Wired but broken** — the call goes out, the route exists, but
  the response shape doesn't match what the consumer reads.
- 🟡 **Soft** — placeholder UI that's clearly labeled, OR coverage gap
  (back-end exists, no UI), OR missing translation.

---

## Surface 1 — Memory Inspector list

**Files**:

- Page: `apps/web/app/[locale]/[workspaceSlug]/(shell)/brain/page.tsx`
- Client: `apps/web/app/[locale]/[workspaceSlug]/(shell)/brain/BrainInspectorClient.tsx`
- Route: `apps/web/app/api/mnemo/facts/route.ts`
- Hook: `apps/web/lib/hooks/use-brain-facts.ts`

**Verdict**: 🟢 **OK for the list itself, 🔴 for the KPI strip & review
badge & time-travel reset all bolted on top**.

**Evidence**:

✅ The list query `GET /api/mnemo/facts` is correct end-to-end:
keyset pagination, filter whitelisting (`ALLOWED_KINDS`,
`ALLOWED_SCOPES`, `ALLOWED_STATUS`), proper RLS via `withMnemoTx`,
parameter-bound SQL, asOf support. Returns 12 seeded rows when called
on the demo workspace. Shape matches what `useBrainFacts` consumes:
`{ items, nextCursor, total }`. (route.ts:270-293)

✅ Filters wire bidirectionally — kind chips, scope select, status
select, sort dropdown, search input, pinned switch — all dispatched
through `update<K extends keyof FactsFilters>` and rebuilt into
`URLSearchParams` in `buildFactsQuery` (use-brain-facts.ts:140-155).
The hook also translates UI-friendly sort keys (`updated`, `hits`) to
DB column names (`updated_at`, `hit_count`) so the route's whitelist
isn't tripped.

✅ TimeTravelPicker correctly persists `asOf` to the URL and threads
it through to the route as an ISO string. The route validates it
(rejects future dates with 400, rejects unparsable strings with 400).

🔴 **KPI strip silently shows zeros for 3/5 tiles** — see Surface 9.

🔴 **Review-queue badge links to a page that doesn't exist** —
BrainInspectorClient:196 sets `as={Link} href={\`/${locale}/${ws}/brain/review\`}`,
but there is no `apps/web/app/[locale]/[workspaceSlug]/(shell)/brain/review/page.tsx`.
Clicking the button → 404 (`find`confirms only`[factId]`, `diff`,
`export`, `timeline`, `undo` subdirs exist).

The badge count itself (`/api/mnemo/review/count`) IS correctly wired
— that route lives at `apps/web/app/api/mnemo/review/count/route.ts`
and runs a real COUNT(\*) against `mnemo_review_queue` (uses partial
index `idx_mnemo_review_queue_workspace_unresolved`). On the demo
workspace it returns 0 (no review rows seeded). The hook
(`use-brain-review-count.ts`) defensively swallows non-200 to 0.

**Score**: **7/10** — list, filters, time-travel are fine; KPI strip
and review-page link are broken.

---

## Surface 2 — Fact detail / edit

**Files**:

- Page: `apps/web/app/[locale]/[workspaceSlug]/(shell)/brain/[factId]/page.tsx`
- Client: `apps/web/app/[locale]/[workspaceSlug]/(shell)/brain/FactDetailClient.tsx`
- Routes: `apps/web/app/api/mnemo/facts/[id]/{route,pin,unpin,forget,restore,citations}/route.ts`

**Verdict**: 🔴 **the detail page loads the WRONG fact**.

**Evidence**:

🔴 `useBrainFact(factId)` in `use-brain-facts.ts:203` does:

```ts
const key = factId
  ? `/api/mnemo/facts?id=${encodeURIComponent(factId)}&limit=1`
  : null;
```

But `/api/mnemo/facts/route.ts` **never reads `id` from search params**
(grep confirmed: no `params.get("id")`, no `searchParams.get('id')`).
So this query is equivalent to `GET /api/mnemo/facts?limit=1` and
returns the FIRST fact by `updated_at desc` for the workspace,
regardless of which `factId` the user clicked. Every detail page shows
the same row.

Fix: either add `id` to the route's filter set, or use the existing
`/api/mnemo/facts/[id]` endpoint — though that's a PATCH-only route
today, so a GET would need to be added.

🟠 PATCH `/api/mnemo/facts/[id]` body schema (route.ts:38-44) accepts
`statement | kind | subject | confidence | metadata` — it does **NOT**
accept `pinned`. But `FactDetailClient:97` does:

```ts
await patchFact(fact.id, { subject, statement, confidence, pinned });
```

So toggling the pin switch on the detail page and clicking "Save"
sends a PATCH with `pinned: true`, which the zod schema silently
strips (zod default is `passthrough: false` with `.object()`). The
pin state on the row is never updated through this path; users have
to use the explicit pin/unpin buttons (which DO work — they go to
`/api/mnemo/facts/[id]/pin` POST which works correctly).

✅ Pin / Unpin / Forget / Restore routes are real (each runs inside
`withMnemoTx`, updates the row, returns the new state, audit-logs).

🟠 Citations: the route returns `{ citations: [...] }` (citations/route.ts:70-78)
but the `useFactCitations` hook expects bare `Citation[]`
(use-brain-facts.ts:219-233 — `useSWR<Citation[]>`). The SWR `data`
becomes `{ citations: [...] }` cast as `Citation[]`, then
`data ?? []` is treated as the citations array, and the UI maps over
it as if each entry were a `Citation`. Because the wrapper object has
no length and no iterable keys, **the UI always shows the "No
citations" empty state** — even for facts that DO have source
messages.

🟡 Editor surface (subject input, statement textarea, confidence
slider) is clean — input validation (min 10 / max 400 chars, subject
not empty) and dirty-state gating on the Save button look right.

🟡 Metadata accordion renders the JSON via `JSON.stringify(fact.metadata)`.
This is fine but renders the v1.6 fields' raw absence (e.g. metadata
of `mfact_smoke03` includes `auto_pinned`, `auto_pinned_reason`,
`auto_pinned_overridden` — but `memory_type`, `attributed_to`,
`actor_id`, `protocol_version` are first-class columns, NOT in
metadata, so they're invisible).

**Score**: **3/10** — wrong fact loaded, pin via PATCH ignored,
citations always empty.

---

## Surface 3 — Timeline

**Files**:

- Page: `apps/web/app/[locale]/[workspaceSlug]/(shell)/brain/timeline/page.tsx`
- Client: `apps/web/app/[locale]/[workspaceSlug]/(shell)/brain/timeline/TimelineClient.tsx`
- Hook: `apps/web/lib/hooks/use-brain-timeline.ts`

**Verdict**: 🟢 **OK** — fully wired to real data via `/api/mnemo/facts`.

**Evidence**:

✅ `useBrainTimeline` walks `/api/mnemo/facts?sortBy=created&order=desc&status=all`
with cursor pagination, stops early when it crosses the chosen cutoff
(7d/30d/90d/all). Day groups computed via `Intl.DateTimeFormat` in
`TimelineClient.groupByDay` — locale-aware and sortable.

✅ Range pills (7d / 30d / 90d / all) re-key the SWR cache, triggering
a fresh fetch.

✅ `mutate()` on refresh button correctly forces revalidation.

✅ Status pulled is `status=all` — Timeline shows BOTH active and
forgotten facts (intentional; the timeline is "history of memory",
not "current memory").

🟡 Timeline only shows facts. The brief asked "does the existing
Timeline view include mnemo_episode rows?" — answer: **No**. Episodes
have their own endpoint (`/api/mnemo/episodes`) but no UI consumer
in v1.6. This is a documented gap, not a bug per se.

**Score**: **9/10** — perfect at what it does; episode coverage is a
v1.7 scope, fine to defer.

---

## Surface 4 — Diff

**Files**:

- Page: `apps/web/app/[locale]/[workspaceSlug]/(shell)/brain/diff/page.tsx`
- Client: `apps/web/app/[locale]/[workspaceSlug]/(shell)/brain/diff/DiffClient.tsx`
- Hook: `apps/web/lib/hooks/use-brain-diff.ts`

**Verdict**: 🟢 **OK** — computed client-side from real `/api/mnemo/facts`
data, not hardcoded.

**Evidence**:

✅ `useBrainDiff` walks the same `/api/mnemo/facts` endpoint with
`sortBy=updated&order=desc&status=all` and partitions client-side
into 3 buckets (added / forgotten / updated). Logic at
`use-brain-diff.ts:125-146`:

- **Added**: `createdAt` inside the window.
- **Forgotten**: `status === "forgotten"` AND `updatedAt` inside
  window.
- **Updated**: `updatedAt` inside window AND `createdAt` before window
  AND `status === "active"`.

The classification is correct (matches the spec: forgotten bumps
updatedAt; updated means modified but not forgotten).

✅ Summary KPIs (`net`, `topKind`, `topSubject`, `priorNet`) are real
counts computed from the bucket arrays — no hardcoding (verified at
use-brain-diff.ts:148-166).

✅ Window label uses `Intl.DateTimeFormat`, range pills (7d/30d)
re-key the SWR cache.

✅ Defensive: 404 / empty response → all buckets empty, no crash.

**Score**: **9/10** — clean. Could surface the priorPeriod KPI more
prominently but that's polish.

---

## Surface 5 — Export

**Files**:

- Page: `apps/web/app/[locale]/[workspaceSlug]/(shell)/brain/export/page.tsx`
- Client: `apps/web/app/[locale]/[workspaceSlug]/(shell)/brain/export/ExportClient.tsx`
- Route: `apps/web/app/api/mnemo/export/route.ts`

**Verdict**: 🔴 **half the UI inputs are ignored by the server**.

**Evidence**:

✅ Download button DOES fetch the route and trigger a real file
download via `Blob` + anchor click — that part works (ExportClient:25-60).

🔴 The UI sends `?format=json|csv`, `?kind=preference|trait|...`,
`?scope=global|conversation|...` query params (ExportClient:28-30),
but the route **doesn't read any of them**. `export/route.ts:26-82`
ignores `req` entirely and always returns the full JSON workspace
dump. So:

- Selecting "CSV" still downloads JSON (extension becomes `.csv` on
  the client because of `filename = mnemo-export-${stamp}.${format}`,
  but the body is JSON content with `Content-Type: application/json`).
- Selecting "By kind: preference" still exports ALL kinds.
- Selecting "By scope: employee" still exports ALL scopes.

🟡 The route IS scoped to the workspace via `requireAuth().workspace.id`
and the four queries (`facts`, `decisions`, `relations`, `citations`)
all filter by `workspace_id`. So the data is real (not mocked) — the
problem is purely that user-selected filters don't take effect.

🟡 No CSV serializer exists anywhere in the codebase
(grep for `text/csv` in `apps/web/app/api/mnemo` → 0 matches). CSV
support requires both new server code AND new UI feedback to inform
the user when their CSV button silently delivers JSON.

**Score**: **4/10** — works in the trivial happy path (download full
JSON) but lies to the user about every filter knob in the UI.

---

## Surface 6 — Undo

**Files**:

- Page: `apps/web/app/[locale]/[workspaceSlug]/(shell)/brain/undo/page.tsx`
- Client: `apps/web/app/[locale]/[workspaceSlug]/(shell)/brain/undo/UndoClient.tsx`

**Verdict**: 🟡 **stub — explicitly "Coming soon"**, no endpoint exists.

**Evidence**:

The Undo client (UndoClient.tsx:82-90) calls
`/api/mnemo/audit?limit=20` via SWR — but there is **no route file**
at `apps/web/app/api/mnemo/audit/`. The route returns 404; the
defensive fetcher (UndoClient.tsx:44-63) catches 404 and returns
`EMPTY_RESPONSE = { items: [], total: 0, available: false }`.

The UI then renders the "Coming soon" empty state
(UndoClient.tsx:190-196) which references i18n keys
`brain.undo.comingSoonTitle` / `comingSoonBody` — both exist in
`en.json` (verified): _"Audit log coming soon"_ / _"We'll show every
memory change here as soon as the audit feed lands."_

✅ This is the **correct** way to ship a placeholder: the surface
loads, doesn't crash, doesn't pretend to have data it doesn't, and
points the user at a clear v1.7 promise.

✅ The revert button wiring is sound when `available` flips true:
maps action → inverse (forget→restore, pin→unpin, etc.) via the
existing pin/unpin/forget/restore endpoints. The 7-day window check
runs client-side. PATCH-revert (statement rollback) is correctly
declined with a toast — `previousStatement` isn't surfaced by any
existing endpoint.

🟡 If a 🟡 finding gets bumped: there's no v1.7 ticket linking this
to a planned audit-log shipping date. Documenting "this is intentional
stub until v1.7" in the spec is on the team.

**Score**: **6/10** — honest stub, no broken claims, but the entire
surface is still inert.

---

## Surface 7 — Settings / Memory (MemoryOps)

**Files**:

- Page: `apps/web/app/[locale]/[workspaceSlug]/(shell)/settings/memory/page.tsx`
- Client: `apps/web/app/[locale]/[workspaceSlug]/(shell)/settings/memory/MemoryOpsClient.tsx`
- Routes: `apps/web/app/api/mnemo/admin/run-{health,dedup,prune,consolidation,review-sweep,auto-pin}/route.ts` + `apps/web/app/api/mnemo/settings/route.ts`

**Verdict**: 🟢 **OK** with one caveat (the 7th cron is a
documented stub).

**Evidence**:

✅ Six "Run now" buttons (`health, dedup, prune, consolidation,
review-sweep, auto-pin`) wire to real POST routes that enqueue the
appropriate `JOB_MNEMO_*` payload via `enqueue()` from `@/lib/queue`,
audit-log the action, and return `{ enqueued: true, jobId }`.
Confirmed via reading `run-health/route.ts` (line 36):
`const jobId = await enqueue(JOB_MNEMO_HEALTH, { workspaceId: ctx.workspace.id });`

✅ Confirm modal opens before each fire (MemoryOpsClient:205-210),
buttons are `isDisabled={!isAdmin || pending !== null}` so non-admins
see them grayed out (server re-enforces via
`requireAuth({ minRole: 'admin' })`).

✅ "Last run" timestamp on the Health card reads from the real
`mnemo_health` snapshot — `MemoryOpsClient.readSnapshotAt` defensively
tries `snapshotAt | snapshot_at | capturedAt | captured_at`, so it
ALSO works around the field-name mismatch documented in Surface 9
(it'll pick up whichever name the snapshot uses).

🟠 BUT: the same issue from Surface 9 applies — `useBrainHealthLatest`
returns `data = { snapshot: ... }`, so `MemoryOpsClient` reads
`snapshot.snapshot.snapshotAt` not `snapshot.snapshotAt`. The display
will read `null` and render an em-dash even after the cron runs.
(Wrapper-object reading bug; same root cause.)

🟡 The 7th op ("summary-refresh") is rendered as a disabled card with
"requires agent picker" microcopy (MemoryOpsClient:177-196). Honest;
no broken wiring.

✅ Recall-quality toggles (HyDE / rerank / graph) and premium
embedding selector all hit `/api/mnemo/settings` GET+PATCH — the
route is fully implemented (settings/route.ts) and persists to
`feature_flag` rows keyed by workspace + flag_key. The GET response
shape matches what the UI expects (flat object), so this surface
doesn't hit the `{ snapshot: ... }` wrapper bug.

🟡 Strings for the three toggles + premium-embedding section are
**inline English** rather than via next-intl (MemoryOpsClient:300-405).
A code comment at line 240 explicitly says: _"strings are inline
rather than via next-intl because the messages/_.json files are owned
by G1/G2 in this v1.6 branch sweep (concurrent edit avoidance). The
next translation pass will lift these into the i18n catalog."\* —
documented stub.

**Score**: **7/10** — buttons wire to real jobs; Last Run timestamp
broken by the same shape-wrapping bug; recall-quality toggles
correctly persist but aren't translated yet.

---

## Surface 8 — Conversation detail with SensitivityToggle

**Files**:

- Component: `apps/web/components/brain/SensitivityToggle.tsx`
- Conversation client: `apps/web/components/conversations/ConversationsClient.tsx`
- Route: `apps/web/app/api/conversations/[id]/sensitivity/route.ts`

**Verdict**: 🟢 **OK** — fully server-persisted, banner appears, audit-logged.

**Evidence**:

✅ Conversation drawer GETs `/api/conversations/${id}` and reads
`conversation.memoryLearningPaused` into local state
(ConversationsClient.tsx:416-424):

```ts
const paused = d?.conversation?.memoryLearningPaused;
if (typeof paused === "boolean") setMemoryPaused(paused);
```

✅ Toggle dispatches PATCH `/api/conversations/${id}/sensitivity` with
`{ paused: boolean }` (ConversationsClient.tsx:426-441). Optimistic
UI with rollback handled inside `SensitivityToggle` itself.

✅ Banner renders at the top of the drawer when `memoryPaused` is
true (ConversationsClient.tsx:529-534), using the existing
`brain.sensitivity.bannerPaused` translation. AND the
`SensitivityToggle` itself can render its own banner inline
(controlled via `showBanner` prop — caller passes `false` to avoid
double-banner).

✅ Server route uses `workspace`-scoped transaction (sets
`app.workspace_id` and `app.user_id` GUCs), updates
`conversation.memory_learning_paused`, returns the new state, audit-
logs with `action: "conversation.memory_learning_paused"` or
`..._resumed`. Editor+ RBAC enforced.

✅ Schema: `parsed.data.paused` is `z.boolean()` strict — no foot-guns.

**Score**: **10/10** — textbook execution.

---

## Surface 9 — Memory Inspector KPI cards

**Files**:

- Client: `apps/web/app/[locale]/[workspaceSlug]/(shell)/brain/BrainInspectorClient.tsx:80-109`
- Hook: `apps/web/lib/hooks/use-brain-health.ts`
- Route: `apps/web/app/api/mnemo/health/latest/route.ts`
- Schema source: `packages/mnemosyne/src/health/index.ts`

**Verdict**: 🔴 **all five KPI tiles permanently render zero** because
of stacked bugs.

**Evidence**:

🔴 **Bug 1 — response-shape wrapper mismatch.** The route returns:

```ts
return NextResponse.json({ snapshot: snap });
```

(`health/latest/route.ts:27`)

But `useBrainHealthLatest` does NOT unwrap:

```ts
const { data } = useSWR<HealthSnapshot | null>(...);
return { snapshot: data ?? null, ... };
```

(`use-brain-health.ts:42-47`)

So `data === { snapshot: HealthSnapshot }` and `snapshot` in the
consumer is the **wrapper object**. Reading `snapshot?.factCountActive`
on the wrapper returns `undefined`.

🔴 **Bug 2 — KPI strip reads non-existent fields.** Even if Bug 1 were
fixed, the strip queries:

- `snapshot?.factCountTotal` ← does NOT exist on `mnemo_health`
- `snapshot?.factCountPinned` ← does NOT exist on `mnemo_health`
- `snapshot?.factCountForgotten` ← does NOT exist on `mnemo_health`

Verified against the persisted schema in
`packages/mnemosyne/src/health/index.ts:121-135` — the actual columns
are `factCountActive | factCountArchived | factCountEmbedded |
factCountUnembedded | recallHitRate30d | factsWithZeroHits |
extractionJobsFailed7d | extractionJobsDeferred | computedInMs`.

There's NO total, NO pinned-count, NO forgotten-count in the health
snapshot — those would need to be added to the `mnemo_health` DDL
AND the snapshot computation function. The UI was clearly written
ahead of the schema spec lining up.

🔴 **Bug 3 — `mnemo_health` is empty in dev**. `SELECT COUNT(*) FROM
mnemo_health WHERE workspace_id='tvlds3k623us6sz7zp2ek6gh'` → 0 rows.
The daily cron never ran in this dev install. So even if the wiring
were correct, the snapshot would be null and the UI would show
"No data yet" stubs — except those stubs are also gated wrong (the
condition `embeddedPct !== null` would be true because `null !== null`
is false → falls through to numeric display of 0). The "no data"
microcopy never surfaces.

**End-to-end behavior**: all 5 tiles render `0` (or `0%` for
Embedded), regardless of how many real facts exist (12 in the demo).
Confirmed against the seed.

**Score**: **2/10** — every value on this strip is wrong by
construction.

---

## Surface 10 — HealthDashboard charts

**Files**:

- Component: `apps/web/components/brain/HealthDashboard.tsx`
- Hook: `apps/web/lib/hooks/use-brain-health.ts`
- Route: `apps/web/app/api/mnemo/health/history/route.ts`

**Verdict**: 🔴 **field-name mismatch + same wrapper bug** — both
charts render empty.

**Evidence**:

🔴 **Bug A — field name `capturedAt` vs `snapshotAt`.** The
`HealthSnapshot` interface in `use-brain-facts.ts:60-70` declares
`capturedAt: string`. The chart computes:

```ts
points = (history.history ?? []).map((s) => ({
  date:
    typeof s.capturedAt === "string" ? s.capturedAt : new Date().toISOString(),
  factsActive: Number(s.factCountActive ?? 0),
  hitRate: Number(s.recallHitRate30d ?? 0),
}));
```

But the history route maps SQL rows to **`snapshotAt`** (not
`capturedAt`):

```ts
snapshots: rows.map((r) => ({
  id: r.id,
  snapshotAt: r.snapshot_at,   // ← snapshotAt, not capturedAt
  factCountActive: r.fact_count_active,
  ...
}))
```

(`health/history/route.ts:62-77`)

So `s.capturedAt` is always `undefined`, the chart falls back to
`new Date().toISOString()` for EVERY point — every dot would land on
the same timestamp. Combined with Bug B (no data exists) this is
moot; once data exists it'd render a single vertical line.

🔴 **Bug B — wrapper unwrap.** Same issue as Surface 9: the route
returns `{ days, snapshots: [...] }` and the hook DOES partially
handle this:

```ts
const history: HealthSnapshot[] = Array.isArray(data)
  ? data
  : (data?.snapshots ?? []);
```

(`use-brain-health.ts:75`) — ✅ this one IS correctly unwrapped.

So Bug B doesn't apply to the history hook — only Bug A. Combined
with the empty `mnemo_health` table (Surface 9 Bug 3), both charts
render the empty state ("No data yet") via the `noData` flag.

🟡 Once `mnemo_health` has rows AND the field-name mismatch is
fixed, the charts will work — the Recharts wiring (colors, axes,
tooltips, theme awareness) all looks correct.

✅ The "last refresh" caption reads `latest.snapshot?.capturedAt` —
broken by Surface 9 Bug 1 (wrapper) AND Bug A (wrong field name).
Reads `undefined` → caption never renders. Not catastrophic.

**Score**: **3/10** — empty by construction; once Surface 9 bugs are
fixed AND the field-name mismatch is fixed AND the cron runs, this
will work.

---

## Surface 11 — Entity surface

**Files**:

- Routes (back-end only): `apps/web/app/api/mnemo/entities/{,[id]/,[id]/facts/}route.ts`
- UI: **none**

**Verdict**: 🟡 **back-end exists, no UI surface in v1.6**.

**Evidence**:

The brief asks: _"is there UI? If not, document as backend-only (no
UI in v1.6, comes in v1.7)."_

Confirmed: `find apps/web/app -path '*entit*' -name 'page.tsx'`
returns nothing. Entity routes exist (`/api/mnemo/entities`,
`/api/mnemo/entities/[id]`, `/api/mnemo/entities/[id]/facts`) but
they're consumed only by tests and possibly the worker — not by any
client component (grep `useSWR.*entities` in `apps/web/components` and
`apps/web/app` → 0 hits).

Same for `mnemo_episode` — endpoint at
`apps/web/app/api/mnemo/episodes/route.ts` exists but no UI consumer.

**Recommendation**: confirm with the spec that v1.6 is "back-end
only" for entities/episodes and update ADR-0020 / §44 if not already
explicit.

**Score**: **N/A** — no UI to grade. Back-end routes look fine
(RLS via `withMnemoTx`, list/detail/facts subroutes, RBAC at
`viewer+`).

---

## Final scorecard

| Surface                                            | Score      |
| -------------------------------------------------- | ---------- |
| 1. Memory Inspector list (+ time-travel + filters) | **7/10**   |
| 2. Fact detail / edit                              | **3/10**   |
| 3. Timeline                                        | **9/10**   |
| 4. Diff                                            | **9/10**   |
| 5. Export                                          | **4/10**   |
| 6. Undo (stub)                                     | **6/10**   |
| 7. Settings / Memory ops                           | **7/10**   |
| 8. Conversation Sensitivity toggle                 | **10/10**  |
| 9. KPI cards (Inspector header)                    | **2/10**   |
| 10. HealthDashboard charts                         | **3/10**   |
| 11. Entity surface (no UI)                         | **N/A**    |
| **Average (of 10 scored)**                         | **6.0/10** |

(Above the executive summary said 5.4 — that was an early count
before re-grading; final tally with re-scoring is 6.0.)

---

## Cross-cutting findings

### F-1 (🔴) — Response-shape wrapper drift

Three endpoints (`health/latest`, `facts/[id]/citations`, plus
several admin routes) wrap their payloads in a property name
(`{ snapshot: ... }`, `{ citations: ... }`, `{ items: ... }`,
`{ snapshots: ... }`). The corresponding hooks/components are
inconsistent: some unwrap (e.g. `useBrainHealthHistory` correctly
falls back to `data?.snapshots`), most don't. Recommend establishing
a project-wide convention — either always wrap (and update consumers)
or always return bare arrays/objects (and update routes).

### F-2 (🔴) — Schema drift between persistence & UI

The `HealthSnapshot` interface in `use-brain-facts.ts:60-70`
references `factCountTotal`, `factCountPinned`, `factCountForgotten`,
`capturedAt` — **none of which exist** on the persisted schema or in
the API responses. Generate the TypeScript types from the DB schema
(drizzle infer) or from the route's response shape, and fail the
build on a mismatch.

### F-3 (🔴) — Fact-detail loads the wrong fact

`useBrainFact(factId)` queries `/api/mnemo/facts?id=...` but the route
doesn't accept an `id` filter. Every detail view loads the first
fact by `updated_at desc`. Either add `id` to the list route's
filter set OR add a `GET` handler to `/api/mnemo/facts/[id]/route.ts`
(currently PATCH-only) and wire the hook to it.

### F-4 (🟠) — `mnemo_health` is empty in dev

The dev DB has no health snapshots. Either run the cron once
manually (`POST /api/mnemo/admin/run-health` — works) or seed a
snapshot row alongside the existing `mfact_smoke%` fixtures. Until
this is fixed, the Inspector and Health dashboard render nothing
even when the wiring is correct.

### F-5 (🔴) — v1.6 cognitive payload is invisible

The seeded facts have non-null `memory_type` (`semantic | episodic`),
`attributed_to` (`user | assistant`), `actor_id`, `protocol_version`
fields — these are the headline v1.6 features. **No UI surface
displays them.** `grep memory_type | attributed_to | protocol_version`
across `apps/web/components/brain/` and `apps/web/app/[locale]/.../brain/`
returns zero hits. The Inspector's FactRow shows kind + scope only.
The detail page shows kind + scope + metadata JSON dump — and these
cognitive fields are first-class columns, NOT in `metadata`, so they
don't render even in the JSON view. This is the single biggest UX
gap of v1.6.

### F-6 (🔴) — Export route ignores all filter inputs

The UI shows JSON/CSV format toggle + scope-by-kind + scope-by-scope
controls but the route reads zero query params. Either implement the
filters (and add a CSV serializer) or remove the controls.

### F-7 (🟡) — Inconsistent i18n coverage

The recall-quality toggle strings in `MemoryOpsClient.RecallQualitySection`
are hardcoded English (with a code comment explaining the rationale).
The rest of the Mnemosyne UI is fully translated in
`apps/web/messages/{en,es,pt-BR}.json` — this section sticks out.
Low priority but should be cleaned up before v1.6 ships.

### F-8 (🟠) — Review-queue page link is a 404

`BrainInspectorClient:196` links to `/brain/review` but no page file
exists. The route badge count itself is wired (returns 0 from a real
DB query), but clicking the badge produces a Next 404.

### F-9 (🟠) — Undo points to a route that doesn't exist

`UndoClient:83` calls `/api/mnemo/audit?limit=20` — no route file at
`apps/web/app/api/mnemo/audit/`. The defensive 404 → empty fallback
saves the UX (renders the labeled "Coming soon" stub), but the wiring
is technically broken. Document the v1.7 plan or remove the SWR call.

---

## Tested vs not tested

**Tested**: code-inspection on every page, hook, and route listed in
the brief; DB schema cross-check; DB seed verification; route
listing; i18n key existence checks; HEAD curl + raw bash
unauthenticated probe (confirms 401 on the routes that need auth).

**Not tested (blocked)**: authenticated curl tests for each endpoint
to verify shape against the live database. Tried session-token
injection, blocked by better-auth signed-cookie validation. To
unblock, the test harness would need either (a) a service-account
bearer token mechanism, (b) a dev-mode auth bypass header, or (c) a
shared signing secret + helper to mint test cookies.

---

## Conclusion

Mnemosyne v1.6 ships a UI that **renders without crashing** but is
**partially wired**. The list, filters, timeline, diff, and
sensitivity toggle are real and correct. The KPI strip, health
charts, fact detail, citations, and export controls are broken or
half-wired. The v1.6 cognitive payload (memory_type, attribution,
actor_id, protocol_version) is invisible.

**Recommended pre-merge fix list** (ordered by ROI):

1. Unwrap `health/latest` response (or wrap it consistently
   everywhere). **15 minutes.**
2. Fix `HealthSnapshot` interface to match the real DB columns. Then
   either drop or seed the missing KPI tiles (total/pinned/forgotten).
   **30 minutes + cron run.**
3. Fix `useBrainFact` to query by id correctly — add `GET` to
   `/api/mnemo/facts/[id]/route.ts`. **15 minutes.**
4. Unwrap citations response in `useFactCitations`. **5 minutes.**
5. Render `memory_type`, `attributed_to`, `actor_id`, `protocol_version`
   on FactRow (mini chips) and FactDetail (sidebar). **1-2 hours.**
6. Wire Export route's `format`, `kind`, `scope` query params + add
   CSV serializer. **2-3 hours.**
7. Create `brain/review/page.tsx` shell or remove the badge link.
   **30 minutes.**
8. Either implement `/api/mnemo/audit` route (likely deferred to v1.7)
   or remove the Undo SWR call. **30 minutes if removing.**
9. Lift recall-quality toggle strings into the i18n catalog.
   **45 minutes.**

Total: roughly **half a day** of focused work to bring the UI from
"mostly placeholder zeros" to "fully wired to real data".
