# Cross-Workspace Consolidation — Design

**Status:** Design — explores the problem space, picks a concrete shape, calls out the parts that need legal / security review before any code lands.
**Author:** Initial draft 2026-05-30.
**Predecessor:** [Consolidation v1.4](../../packages/mnemosyne/src/consolidation/) (single-workspace REM-style, shipped).
**Related:** [Mnemosyne v2 design](./2026-05-30-mnemosyne-v2-design.md) §11 (deferred from v2 spec into this one).

---

## 1. Problem

Single-workspace consolidation (v1.4) clusters semantically-similar facts within ONE workspace and asks the cheap-tier LLM to write a `derived_from` summary that supersedes them. Works great per-tenant.

**Enterprise tenants want the next thing:** an organization with N workspaces (one per team, one per project, one per business unit) and a shared knowledge surface. Today, two workspaces in the same org can hold near-identical facts ("the company's primary auth provider is Okta") without any cross-pollination. The org-admin sees N copies, the agents in workspace A can't access workspace B's facts, and the consolidation cron has no idea the duplicates exist.

What enterprise wants:

1. **Cross-workspace visibility for org admins** — a unified view of "facts across all workspaces in my org."
2. **Cross-workspace dedup** — when the same fact lands in two workspaces, mark them as semantically-linked without copying.
3. **Org-scoped facts** — a facts-bucket above workspaces, visible to all workspaces in the org but writable only by org-admins.

Items 1+2 are consolidation-shaped (read + analyze, no new writes to agent-facing memory). Item 3 is a new primitive (`org_fact`). This doc focuses on **1+2** — item 3 is a separate larger design.

---

## 2. The hard part: RLS

Mnemosyne's defining security guarantee is **RLS + FORCE Pattern A + role downgrade** (ADR-0010). Every query runs as `app_user` (no BYPASSRLS) with `app.workspace_id` GUC set. The DB enforces "you can't see another workspace's data" structurally.

A cross-workspace read seems to require breaking this. It doesn't have to — but the design has to be careful.

### 2.1 Three flawed approaches (call them out first)

**Approach A: drop RLS for the consolidation cron.**
Run the cron as the postgres superuser, scan everything, write summary records. **Rejected.** A single bug in the cron query (forgetting to filter by org_id, joining the wrong table) leaks one tenant's data into another's recall. This is the exact failure mode RLS exists to prevent. We are not letting any cron bypass it.

**Approach B: query each workspace separately and union in app code.**
Run N RLS-respecting queries (one per workspace_id in the org), then merge in TypeScript. **Rejected.** Two problems: (a) for an org with 50 workspaces this is 50 round-trips per consolidation pass; (b) the merge has to happen in app code with no RLS gate, so a bug in the merge logic (returning the wrong workspace's rows) is just as bad as approach A. Loses the structural guarantee.

**Approach C: a new `app_org_user` role with RLS scoped to org membership.**
Add an `org_id` column to `mnemo_fact`. New role inherits visibility across all workspaces with matching `org_id`. **Partially viable but heavyweight** — requires adding `org_id` to every mnemo\_\* table, plumbing the GUC through `withMnemoTx`, and reworking every existing policy. We'd be writing migration 0048-0060 just to set this up, plus a regression suite. Worth it ONLY if items 1+2 turn out to be a major enterprise feature.

### 2.2 The right approach: scoped read-only views

**Approach D (proposed):** Materialize a `mnemo_org_fact_view` table that's populated by a privileged service-role cron and read by a _separate_ RLS-scoped role.

```
                                    │
                  (org-cron, runs   │   (org-scoped reader, runs as
                   as service-role) │    app_org_user with GUC org_id)
                                    │
  mnemo_fact ──► [consolidation] ──►│──► mnemo_org_fact_view ──► org-admin UI
   (per-ws RLS)   (cron job)        │       (org-scoped RLS)      / consol cron
                                    │
                                    │
```

Properties:

- The org-cron is the ONLY thing that reads cross-workspace. It writes summary rows (NOT raw facts) into `mnemo_org_fact_view`. Each row carries `{org_id, fact_ids[], statement_summary, similarity_score, source_workspaces[]}`. No PII beyond what the summary LLM emitted.
- Org admins / org-consol-cron read `mnemo_org_fact_view` under an `app_org_user` role that's RLS-gated on `org_id`.
- Per-workspace `app_user` reads are unchanged. No new column on `mnemo_fact`. Zero changes to the per-workspace recall hot path.
- The cross-workspace cron is the ONLY place that touches cross-workspace data, and it's running as a service-role inside a fenced job. Easy to audit, easy to disable.

This is the approach v2.x can ship without rewriting the RLS architecture.

---

## 3. Schema

### 3.1 New table

```sql
CREATE TABLE mnemo_org_fact_view (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  -- Source: the facts that contributed to this org-level summary.
  source_fact_ids uuid[] NOT NULL,
  source_workspace_ids uuid[] NOT NULL,
  -- LLM-written summary of the clustered facts. PII-redacted at write time.
  statement_summary text NOT NULL,
  -- Average cluster cosine similarity (for cluster strength UI).
  cluster_similarity real NOT NULL,
  -- Subject + kind inherit from the dominant cluster member.
  subject text NOT NULL,
  kind    text NOT NULL,
  -- Provenance: only ever 'org_consolidation' for now. Field reserved
  -- so future cross-workspace sources (manual org-admin entry,
  -- third-party import) can disambiguate.
  source    text NOT NULL DEFAULT 'org_consolidation',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mnemo_org_fact_view_org_id ON mnemo_org_fact_view (org_id);
CREATE INDEX idx_mnemo_org_fact_view_subject ON mnemo_org_fact_view (org_id, subject, kind);
```

### 3.2 New role

```sql
CREATE ROLE app_org_user NOLOGIN;
GRANT SELECT ON mnemo_org_fact_view TO app_org_user;
-- NO write grants. Only the service-role cron writes this table.
-- NO grants on mnemo_fact / mnemo_relation / mnemo_episode — the
-- org-scoped reader has zero visibility into per-workspace tables.
```

### 3.3 RLS

```sql
ALTER TABLE mnemo_org_fact_view ENABLE ROW LEVEL SECURITY;
ALTER TABLE mnemo_org_fact_view FORCE ROW LEVEL SECURITY;

-- app_org_user sees rows for the org GUC.
CREATE POLICY org_user_select ON mnemo_org_fact_view
  FOR SELECT TO app_org_user
  USING (org_id::text = current_setting('app.org_id', true));

-- Service-role bypass is implicit (superuser, no policy needed).
```

### 3.4 New tx wrapper

```typescript
withMnemoOrgTx(orgId, fn) {
  // Mirror of `withMnemoTx`: opens a tx, sets `SET LOCAL app.org_id`,
  // downgrades to `app_org_user`. The org_id is the only GUC needed —
  // the role has no workspace-scoped visibility, so the workspace_id
  // GUC is left unset (and would be ignored by the org policy anyway).
}
```

---

## 4. The org-consolidation cron

### 4.1 Algorithm

```
For each org:
  1. Pull facts across all workspaces in the org, BUT only their
     embeddings + minimal metadata (id, subject, kind, ws_id). NEVER
     pull the full statement.  Run this as a single service-role query.
  2. Cluster by (subject, kind) + cosine >= 0.85 across workspaces.
  3. For each multi-workspace cluster (≥2 workspaces, ≥2 facts):
     a. Fetch full statements for ONLY the cluster members.
     b. Run PII detection on each statement; redact before sending to LLM.
     c. Ask the org's cheap-tier LLM to write a one-sentence summary.
     d. Insert into mnemo_org_fact_view.
  4. For single-workspace clusters: ignore (covered by per-workspace
     consolidation already).
```

### 4.2 Why this is safer than approach A

- The cron NEVER joins org data into a single SELECT that returns full statements. The "what are the cluster members" question is answered with `(workspace_id, fact_id, embedding)` tuples only.
- The full-statement fetch is one query per cluster, each clearly scoped to a specific `fact_id IN (...)` list with the cluster's `workspace_id`s as a filter. A single review can prove the query is bound to the cluster.
- The LLM summary call gets PII-redacted text. The org-level summary by construction can't leak verbatim PII from any source fact.

### 4.3 Cron schedule

Weekly. Per-org. Skewed across the cron window so no two orgs run at the same minute. Cost model: O(orgs × avg_cluster_count × LLM_call_cost). At 100 orgs × 50 clusters × $0.001/call = $5/week. Cheap.

### 4.4 What it does NOT do

- Does NOT modify per-workspace `mnemo_fact` rows. The source facts stay untouched.
- Does NOT auto-pin or auto-supersede anything. Surfacing only.
- Does NOT cross org boundaries — facts in org A and org B with the same content stay independent. The cluster step filters by `org_id`.

---

## 5. Surface

### 5.1 Org-admin UI

New route: `/admin/orgs/[orgId]/memory/cross-workspace`

Shows the `mnemo_org_fact_view` rows for the org as a list:

- Each row: summary text, source workspaces (linked), cluster strength bar.
- Filters: by subject, by kind, by minimum cluster size, by minimum similarity.
- Actions: "View source facts" (deep-links into the workspace inspector for each source).

### 5.2 Agent runtime usage

`recallUnified` is **NOT** extended to read `mnemo_org_fact_view`. Org-level facts stay org-admin visible only. If an agent in workspace A wants org-level knowledge, the org-admin has to explicitly create a corresponding workspace-scoped fact in A.

The reasoning: silently surfacing another workspace's data — even via an LLM summary — into agent context would be a surprising tenant boundary violation. We make the surfacing visible (admin UI) and explicit (manual copy if wanted).

### 5.3 MCP / API

No MCP surface for cross-workspace data in v2.0. If org-admins want programmatic access, a separate `/api/orgs/[orgId]/memory/cross-workspace` REST surface with `assertOrgAdmin` middleware. Out of scope for the consolidation impl PR.

---

## 6. Privacy + GDPR

### 6.1 What's stored where

| Layer                             | Contents                                | Lifecycle on workspace delete                                           |
| --------------------------------- | --------------------------------------- | ----------------------------------------------------------------------- |
| `mnemo_fact` (per-workspace)      | Verbatim facts                          | Cascade delete with workspace                                           |
| `mnemo_org_fact_view` (org-scope) | LLM summary referencing source fact IDs | Source fact IDs become dangling; row marked `stale=true` via FK trigger |

### 6.2 Right-to-erasure

When a workspace is GDPR-exported + deleted:

- All `mnemo_fact` rows are scrubbed (existing behavior).
- The `mnemo_org_fact_view` rows that reference those fact_ids in `source_fact_ids[]` are flagged stale. A follow-up cron re-clusters and removes rows that drop below the minimum cluster size threshold.
- The LLM-summary text in the org view is regenerated WITHOUT the deleted workspace's contribution (or removed entirely if only one workspace remains in the cluster).

### 6.3 Disclosure

Org-level summaries are visible to org admins. Add a clear "this summary was generated from facts in [N workspaces]; the source facts are not directly visible here" banner in the admin UI to prevent confusion.

---

## 7. Sequence

| Phase | Work                                                                                 | Gate                   |
| ----- | ------------------------------------------------------------------------------------ | ---------------------- |
| **0** | Spec review + legal/security signoff on §6                                           | Required before code   |
| **1** | Migration 0050: `mnemo_org_fact_view`, `app_org_user` role, RLS policy               | After §0               |
| **2** | `withMnemoOrgTx` + Pattern A regression tests                                        | After §1               |
| **3** | `consolidateOrgCluster()` core algorithm (pure, no DB) + unit tests                  | Parallel with §2       |
| **4** | Cron job in `apps/web/worker/org-consolidation-job.ts`                               | After §2 + §3          |
| **5** | Admin UI route                                                                       | After §4               |
| **6** | E2E test: seed 2 workspaces in 1 org, run cron, assert org view shows merged summary | Final gate before ship |

Each phase is reviewable on its own. v1 ships with phases 0-5 (admin can see + manually act on cross-workspace duplicates). Phase 6 is regression coverage.

---

## 8. What we are EXPLICITLY not building

- **Org-scoped agent recall.** Agents stay workspace-scoped. (See §5.2.)
- **Cross-org consolidation.** Each org is a sealed boundary. No global "facts seen across all orgs."
- **Cross-workspace `mnemo_fact` writes.** No writes ever cross workspaces. The org-view is read-only summary.
- **Auto-merge.** No "this fact appears in 3 workspaces, automatically replace with org-canonical version." Manual only.
- **Real-time cross-workspace sync.** Cron-based, weekly. Real-time would require event-bus plumbing across workspace boundaries — out of scope.

---

## 9. Open questions

- **`org` table.** This design assumes an `org` table with `org_workspace` join exists. Verify before phase 1 — if it doesn't, that's an upstream tenant-hardening prerequisite, not part of this work.
- **Embedding access for the cron.** The cron pulls embeddings cross-workspace as a service-role query. Confirm: embeddings are not considered PII for the purposes of org-admin visibility? (They're floats; reconstructing the source text from them is non-trivial but not impossible.) Likely fine; document the position.
- **What about `mnemo_decision` / `mnemo_episode`?** This design only consolidates `mnemo_fact`. Decisions and episodes can also be near-duplicated across workspaces. Defer to v2.x — adding facts only keeps phase 1 reviewable.
- **Throttling.** A 100-workspace org runs one big query for embeddings. At 10M facts per workspace × 100 workspaces = 1B embeddings. That's a non-starter — needs pagination + a per-org `last_consolidated_at` watermark to do incremental scans. Add to phase 3.
