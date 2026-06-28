// apps/web/tests/isolation/routes-static-audit.spec.ts
//
// Static (filesystem + text scan) audit of every Next.js API route handler
// under `apps/web/app/api/`. Every `route.ts` must either:
//
//   1. Reference one of the tenant-scoping helpers (workspace context is
//      derived from session, API key, signed token, or channel resolver —
//      whichever pattern that route follows), OR
//
//   2. Be on an explicit ALLOWLIST of routes that legitimately don't need
//      workspace scoping (health probes, the Better Auth catch-all, the
//      public embed.js script, the HMAC-signed exports download).
//
// Why this test matters: production correctness depends on every API
// route either being session+membership scoped or explicitly opting out.
// The runtime FORCE RLS will catch missing workspace context eventually,
// but it surfaces as a 500 in production. This test fails fast at CI
// time when a developer forgets to add tenant scoping to a new route.
//
// The test is a pure text walk — no Postgres required, runs in
// milliseconds. The global `@orchester/db` mock is dropped only to match
// the convention used by the sibling integration tests in this folder
// (see `db-scan.spec.ts` lines 20–21); the audit itself doesn't touch
// the DB module.
import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Match the convention from db-scan.spec.ts even though this suite is a
// pure filesystem walk — keeps the isolation folder consistent.
vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

// Root of the API tree under audit. Absolute path so the test runs
// correctly regardless of vitest's cwd.
const API_ROOT = join(__dirname, "..", "..", "app", "api");

// Any substring match here counts as "this route scopes by workspace".
// Grouped by strength of tenant isolation:
//
//   GUC-setting helpers (set app.workspace_id inside a transaction — these
//   are the canonical strong-isolation pattern post SEC-2):
//   - requireAction: `lib/auth-guards.ts` — combines requireAuth + GUC setup
//     in one call. The standard entry point for all session-backed routes.
//   - withTenantContext / withWorkspaceTx / requireTenantContext: the
//     canonical per-transaction tenant-scoped helpers in
//     `lib/tenant/context.ts`. Set `app.workspace_id` GUC inside a tx.
//   - withCrossTenantAdmin: `lib/tenant/cron.ts` — bypass-RLS helper used
//     by webhooks/widget where the workspace is derived from a public
//     identifier (channel id, secret token, Stripe customer id).
//   - authenticateApiKey: `lib/api-auth/key.ts` — the v1 public API and
//     the MCP server both resolve workspace via API key + GUC.
//
//   Session helpers (span all workspaces a user owns — correct scoping for
//   cross-workspace meta-routes):
//   - requireAuth / isAuthContext: `lib/auth-guards.ts` — wraps session +
//     workspace + role. Used by routes that haven't migrated to requireAction.
//   - getCurrentSession: `lib/workspace.ts` — session-only routes
//     (`/api/me`, `/api/sessions`) that span all workspaces.
//
//   Slug-based helpers (resolve workspace from URL slug + membership check;
//   weaker than GUC-setting but accepted for workspace-admin routes):
//   - resolveBySlug / checkMembership: `lib/tenant/resolve.ts` +
//     `lib/tenant/membership.ts` — used by `workspaces/[slug]/*` admin
//     endpoints and `me/active-workspace`.
const TENANT_HELPERS = [
  // Strong: GUC-setting (preferred)
  "requireAction",
  "withTenantContext",
  "withWorkspaceTx",
  "requireTenantContext",
  "withCrossTenantAdmin",
  "authenticateApiKey",
  // Session-scoped (cross-workspace meta-routes)
  "requireAuth",
  "isAuthContext",
  "getCurrentSession",
  // Slug-based (workspace-admin routes)
  "resolveBySlug",
  "checkMembership",
];

// Helpers that establish real DB-level tenant context (set app.workspace_id GUC
// or equivalent). Used by the enforcement gate test below.
const CONTEXT_HELPERS = [
  "requireAction",
  "withTenantContext",
  "withWorkspaceTx",
  "requireTenantContext",
  "withCrossTenantAdmin",
  "authenticateApiKey",
];

// Routes that span all workspaces by design (session-scoped, not ws-scoped).
const SESSION_HELPERS = ["getCurrentSession", "requireAuth", "isAuthContext"];

// Routes that resolve workspace from a URL slug rather than session cookie.
const SLUG_HELPERS = ["resolveBySlug", "checkMembership"];

// Routes that legitimately don't scope by workspace. Paths are relative
// to `apps/web/app/api/` and use POSIX separators (the walker
// normalizes Windows backslashes before lookup).
//
// Adding to this list is intentional — every entry below carries a
// one-line comment explaining WHY the route has no workspace scoping.
// If you're tempted to allowlist a new route, double-check that the
// route truly has no workspace data path; the common mistake is
// "the route doesn't read the DB" — which is fine — vs. "the route
// reads the DB but I'll add scoping later" — which is the bug this
// test exists to catch.
const ALLOWLIST = new Set<string>([
  // Health probe — used by load balancers and uptime monitors, no auth.
  "health/route.ts",
  // Better Auth catch-all — manages its own sessions, not workspace-scoped.
  "auth/[...all]/route.ts",
  // Public embed.js script — serves static JS for the floating widget
  // button, no DB access. Workspace is identified by the channel id
  // embedded in the script for the IFRAME target, not this route.
  "embed/route.ts",
  // HMAC-signed GDPR export download — the token carries the storage
  // key + expiry, verified constant-time. No session needed.
  "exports/[token]/route.ts",
  // OAuth callback — receives code from provider redirect; workspace is derived
  // from the HMAC-signed state param (verifySigned), not a session cookie.
  "integrations/oauth/[provider]/callback/route.ts",
  // Static OpenAPI 3.1 spec — public doc, no workspace data, no DB access.
  "v1/openapi.json/route.ts",
  // Compass "What's new" — public CHANGELOG passthrough. The CHANGELOG
  // ships in the repo, no DB access, no per-workspace data path.
  "compass/whats-new/route.ts",
]);

/**
 * Recursively collect every `route.ts` / `route.tsx` under `dir`.
 * Returns absolute paths.
 */
function walkRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkRoutes(full));
    } else if (st.isFile() && (entry === "route.ts" || entry === "route.tsx")) {
      out.push(full);
    }
  }
  return out;
}

function relPosix(absPath: string): string {
  return relative(API_ROOT, absPath).split(sep).join("/");
}

describe("API route handlers static audit", () => {
  it("every route handler is tenant-scoped or explicitly allowlisted", () => {
    const all = walkRoutes(API_ROOT);
    expect(all.length).toBeGreaterThan(0);

    const scoped: string[] = [];
    const allowlisted: string[] = [];
    const violations: string[] = [];
    const helperHits = new Map<string, number>();

    for (const abs of all) {
      const rel = relPosix(abs);
      const src = readFileSync(abs, "utf8");
      const matched = TENANT_HELPERS.find((h) => src.includes(h));
      if (matched) {
        scoped.push(rel);
        helperHits.set(matched, (helperHits.get(matched) ?? 0) + 1);
        continue;
      }
      if (ALLOWLIST.has(rel)) {
        allowlisted.push(rel);
        continue;
      }
      violations.push(rel);
    }

    // Confirm every allowlisted file actually exists on disk — don't let
    // a stale allowlist entry silently mask a missing route.
    const presentRels = new Set(all.map(relPosix));
    const staleAllowlist = [...ALLOWLIST].filter((p) => !presentRels.has(p));

    // eslint-disable-next-line no-console
    console.log(
      `[routes-static-audit] ${all.length} routes total: ` +
        `${scoped.length} tenant-scoped, ${allowlisted.length} allowlisted, ` +
        `${violations.length} violations`
    );
    if (helperHits.size > 0) {
      const breakdown = [...helperHits.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([h, n]) => `${h}=${n}`)
        .join(", ");
      // eslint-disable-next-line no-console
      console.log(`[routes-static-audit] helper breakdown: ${breakdown}`);
    }

    expect(
      staleAllowlist,
      `Stale allowlist entries (file no longer exists): ${staleAllowlist.join(", ")}`
    ).toEqual([]);

    expect(
      violations,
      `routes [${violations.join(", ")}] have no tenant-context import — ` +
        `add to the allowlist if intentional, otherwise wire one of: ` +
        `${TENANT_HELPERS.join(", ")}`
    ).toEqual([]);
  });

  it("no route relies on getCurrentWorkspace without a GUC-setting context helper", () => {
    const all = walkRoutes(API_ROOT);
    const weak: string[] = [];

    for (const abs of all) {
      const rel = relPosix(abs);
      if (ALLOWLIST.has(rel)) continue;
      const src = readFileSync(abs, "utf8");

      const hasContext = CONTEXT_HELPERS.some((h) => src.includes(h));
      const hasSession = SESSION_HELPERS.some((h) => src.includes(h));
      const hasSlug = SLUG_HELPERS.some((h) => src.includes(h));
      const usesWeak =
        src.includes("getCurrentWorkspace") || src.includes("getCurrentWorkspaceBySlug");

      // Weak pattern: relies on getCurrentWorkspace* without a GUC-setting context.
      if (usesWeak && !hasContext) {
        weak.push(rel);
      }
      // No scoping at all: no context, no session, no slug.
      if (!usesWeak && !hasContext && !hasSession && !hasSlug) {
        weak.push(rel);
      }
    }

    expect(
      weak,
      `routes still rely on getCurrentWorkspace without requireAction/withTenantContext ` +
        `(or have no tenant context at all): ${weak.join(", ")}`
    ).toEqual([]);
  });
});
