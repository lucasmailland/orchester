# Mnemosyne v1.6 — Live UI Walkthrough Audit

**Date**: 2026-05-26
**Auditor**: Manual interactive tester via Chrome MCP
**Workspace**: Acme Inc. (`acme-inc`), user `demo@fichap.com`
**Build**: v1.6 (commit on `main`, dev server `:3333`)
**Method**: Real browser session, real clicks, real network captures, no mocks

This audit walks the actual UI in Chrome to verify that the v1.6 memory pillars are not only deployed in code but reachable, interactive, and wired end-to-end. It supplements the static audits done by reviewer subagents.

---

## Summary

| Surface                                       | Status     | Notes                                                                                                                   |
| --------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| Settings → Memory: cron triggers              | ✅ wired   | Confirmation modal → `Job enqueued` toast                                                                               |
| Settings → Memory: HyDE/Rerank/Graph toggles  | ✅ wired   | `PATCH /api/mnemo/settings 200`, `Saved` toast, defaults ON (v1.6 flip confirmed)                                       |
| Settings → Memory: Premium embedding provider | ✅ wired   | Real options (Use default / OpenAI / Voyage / Cohere), Model auto-populates                                             |
| Brain Inspector list                          | ⚠️ partial | 12 facts render; v1.6 cognitive fields NOT shown in rows                                                                |
| Inspector KPI tiles                           | 🔴 broken  | TOTAL FACTS/PINNED/ACTIVE/FORGOTTEN all show 0 despite 12 seeded facts                                                  |
| Inspector Health charts                       | 🔴 broken  | "No data yet" on both 30d charts                                                                                        |
| Inspector kind chips                          | ✅ wired   | PREFERENCE→3, SKILL→2, etc.                                                                                             |
| Inspector Scope/Status/Sort dropdowns         | ✅ wired   | All 5 scope options, 3 status options                                                                                   |
| Inspector Pinned toggle                       | ✅ wired   | 4 of 12 facts pinned (filter works)                                                                                     |
| Inspector Search bar                          | ✅ wired   | "voseo" → 1 of 1 result                                                                                                 |
| Inspector row action menu (⋯)                 | ⚠️ partial | Menu opens with Edit / Unpin / View citations / Forget; all 3 navigation actions hit the broken detail route            |
| Inspector TimeTravelPicker                    | ⚠️ partial | Time-travel mode banner + "Now" button work, but date input parsing drops year (parses 2025 → 0002)                     |
| Fact detail `/brain/[id]`                     | 🔴 broken  | `GET /api/mnemo/facts?id=…&limit=1 → 500` (empty body) → "Couldn't load memory"                                         |
| Diff `/brain/diff`                            | 🔴 broken  | API rejects `sortBy=created` and `sortBy=updated` with `{"error":"Invalid sortBy"}` 400 — page sends wrong column names |
| Timeline `/brain/timeline`                    | 🔴 broken  | "Couldn't load the timeline. Try refreshing."                                                                           |
| Export `/brain/export`                        | ✅ wired   | `GET /api/mnemo/export?format=json 200`, 9KB body with meta + facts array including `attributed_to` field               |
| Undo `/brain/undo`                            | ⚠️ stub    | Honest "Audit log coming soon" stub with 7-day warning                                                                  |
| Review queue `/brain/review`                  | 🔴 broken  | Falls into `[id]` dynamic route → 500 (no real page implemented)                                                        |
| Conversation detail                           | ✅ render  | Loaded conversation pane with cost, tokens, model, message thread                                                       |
| SensitivityToggle                             | ✅ wired   | `PATCH /api/conversations/{id}/sensitivity 200` → yellow banner + toast                                                 |

**Score** based on this walkthrough: **7.0 / 10** — the _write_ side of v1.6 (cron triggers, toggles, sensitivity, export) is solid; the _read_ side (fact detail, diff, timeline, review queue, KPIs, charts, cognitive chips) has multiple broken endpoints.

---

## Detailed findings

### A) Critical bugs (block normal user flow)

#### A1. `/api/mnemo/facts?id=…` returns 500 with empty body

**Reproduces**: any fact detail page (e.g. `/brain/mfact_smoke12`), or row action menu → "View citations" / "Edit".
**Symptom**: page shows "Couldn't load memory." with Back button.
**Network**: `GET /api/mnemo/facts?id=mfact_smoke12&limit=1` → `500` empty response body.

**Hypothesis**: The single-fact-by-id branch in the `facts` route handler is probably running a query missing a `WHERE workspace_id = …` predicate that RLS/FORCE then rejects with an opaque error, OR returning before writing JSON.

**Impact**: Every detail/edit/citation flow from the inspector is unreachable. Major.

#### A2. `/api/mnemo/facts?sortBy=created` and `sortBy=updated` return 400

**Reproduces**: visiting `/brain/diff` (which is why diff appears empty).
**Symptom**: `{"error":"Invalid sortBy"}` 400. Diff page renders chrome but all KPIs show `+0`, `Nothing yet`, etc.
**Verified via JS console**:

```js
fetch("/api/mnemo/facts?sortBy=created&order=desc&limit=5&status=all");
// → {error: "Invalid sortBy"}
fetch("/api/mnemo/facts?sortBy=updated&order=desc&limit=5&status=all");
// → {error: "Invalid sortBy"}
```

The accepted values are likely `created_at` and `updated_at`. The diff page (and possibly other places) sends the short forms.

**Impact**: Diff is non-functional. Major.

#### A3. `/brain/review` and any unknown `/brain/<slug>` falls into `[id]` dynamic route → 500

**Reproduces**: navigate to `/brain/review` (also visible from the header "Review queue" button).
**Symptom**: same "Couldn't load memory" panel because the dynamic `[id]` route tries to fetch a fact with id `review` and 500s.

**Impact**: Header "Review queue" CTA is broken. The Review-queue sweep cron writes data nobody can see.

### B) Cognitive-field display gap (v1.6 not surfaced)

The seeded facts DO contain v1.6 fields — the export JSON shows `attributed_to: "assistant"` and the schema has `memory_type`, `actor_id`, `protocol_version`. But the Inspector list rows only show:

```
[subject] [KIND] [SCOPE]
statement
[confidence%] [hit_count] [last_recall_age]
```

No chip for `memory_type` (semantic/episodic/procedural/working), no chip for `attribution` (user/assistant/system/inferred), no `actor_id` mention, no protocol-version indicator. The v1.6 work shipped the DB columns + API exposure but the UI was not extended.

**Impact**: v1.6 is invisible to the user — they can't see WHY a fact was learned (attribution), WHICH cognitive bucket it belongs to (memory_type), or WHO authored it (actor_id). Major.

### C) KPI + Health regressions

The 5 KPI tiles at the top of `/brain` show:

- TOTAL FACTS: `0`
- PINNED: `0`
- EMBEDDED: `No data yet`
- ACTIVE: `0`
- FORGOTTEN: `0`

Despite the list showing "Showing 12 of 12". The two Health charts also show "No data yet".

**Hypothesis**: KPIs and charts read from a denormalized `mnemo_health_snapshot` row that hasn't been populated (because the snapshot cron has never run — we saw "Last run: —" on Memory health snapshot earlier). After running the snapshot cron once these should populate. The user just enqueued the job via the audit; we did not wait for the worker tick.

**Impact**: New workspaces show meaningless 0/0/0 stats until the first cron tick lands. Should be eagerly computed on first read or shown with a "Run snapshot now" CTA.

### D) TimeTravelPicker date parsing

The input shows `dd/mm/aaaa` placeholder. Typing `01/01/2025` produced URL `?asOf=0002-01-01T23:59:59.999Z` — year became `0002` instead of `2025`. The fields are likely segmented (dd / mm / aaaa) and my keystrokes filled segments in an unexpected order. The Now button + banner work correctly; the bug is in the typed-text → year parsing.

**Impact**: Power-users typing the date will silently land on year-0002 and see empty memory. Minor (calendar picker works), but UX hostile.

### E) Reload note for diff

Even after refreshing, the diff page still issues `sortBy=created` / `sortBy=updated` requests — this is baked into the page's data fetcher. The fix is on the client.

---

## What we proved works perfectly

These are not aspirational — every one of these was clicked or typed in the live tab, and the network/UI confirmed the outcome:

1. **Login flow** (`demo@fichap.com` / `demo1234`) after fixing `BETTER_AUTH_URL` to match dev port 3333.
2. **Settings → Memory operations** — every "Run now" we tested showed a confirmation modal and a `Job enqueued — runs in the next worker tick.` toast.
3. **Settings → Recall quality toggles** — flipping HyDE off and back on both fired `PATCH /api/mnemo/settings 200` with a `Saved` toast.
4. **Settings → Premium embedding** — Provider dropdown lists `Use default`, `OpenAI`, `Voyage`, `Cohere`. Selecting OpenAI auto-populated `text-embedding-3-large` in the Model field and fired `Saved`.
5. **Inspector kind chips, scope dropdown, status dropdown, sort dropdown, search bar, pinned toggle** — all filter the list correctly. Counts update ("Showing N of M").
6. **Row action menu (⋯)** — opens with the four expected actions. (Their _targets_ are broken, but the menu itself is wired.)
7. **`/brain/export`** — the Download CTA hits `GET /api/mnemo/export?format=json` which returns a valid 9KB JSON envelope including workspace meta + facts including v1.6 fields. Toast `Download started.` fires.
8. **Conversation list** + detail pane — both render with real data (tokens, cost, agent, channel, status, model name).
9. **SensitivityToggle** — flipping it ON fires `PATCH /api/conversations/{id}/sensitivity 200`, shows yellow banner `Memory learning is paused for this conversation.`, fires toast `Memory learning paused`.
10. **Time-travel mode banner + Now button** — appear correctly when an asOf is set (date parsing aside).

---

## Recommended fixes (in priority order)

Each could be a tight subagent task.

### P0 — make the read-side work

1. **Fix `/api/mnemo/facts?id=…` 500.** Probably restore `WHERE workspace_id = $ws AND id = $id` plus a defensive `LIMIT 1`. Add a unit test that hits the route with a real seeded id.
2. **Fix `/brain/diff` query.** Audit the `useDiff` (or equivalent) hook to pass `sortBy=created_at` / `sortBy=updated_at`. Also broaden the API to accept both short and long forms (alias) to prevent future regressions.
3. **Implement `/brain/review` page** (or guard the `[id]` dynamic route against reserved slugs like `review`, `timeline`, `diff`, `export`, `undo`).

### P1 — surface v1.6 cognitive fields

4. **Render `memory_type`, `attribution`, `actor_id`, `protocol_version`** chips in `FactRow` + a richer panel in fact detail (once A1 is fixed).
5. **Eagerly compute the initial health snapshot** on first dashboard render OR show an inline "Snapshot pending — run it now" CTA so KPI/Charts aren't 0/empty for new workspaces.

### P2 — polish

6. **TimeTravelPicker year parsing** — switch to a real DatePicker (or constrain the year segment to 4 digits).
7. **`/brain/undo`** — finish the audit-log feed (the page already shows the right stub copy).

---

## How this report was produced

- 1 logged-in Chrome MCP tab on `http://localhost:3333/en/acme-inc/...`
- All clicks, types, dropdown opens, and toggle flips run as real DOM actions.
- All network claims are taken from the live `read_network_requests` tool, not inferred from code.
- All "Saved" / "Job enqueued" / "Memory learning paused" toasts are confirmed in screenshots.
- The cognitive-field gap was confirmed by fetching `/api/mnemo/export?format=json` and reading the actual response body.

The screenshots are in the Chrome MCP session log and can be re-captured by repeating any of the navigation steps in this document.
