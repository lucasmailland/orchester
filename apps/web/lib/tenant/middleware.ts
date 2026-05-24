import "server-only";
import type { NextRequest } from "next/server";

const LOCALE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;
const SLUG_RE = /^[a-z][a-z0-9-]{2,38}[a-z0-9]$/;

/**
 * Non-workspace top-level paths under `/[locale]/`. The middleware
 * must NOT treat the second segment as a workspace slug for these,
 * even if it superficially passes the slug regex — and must NOT 301
 * them into a workspace context.
 *
 * Keep this list in sync with the directories that live directly
 * under `apps/web/app/[locale]/` (auth, marketing, onboarding,
 * checkout, etc.). `workspaces` is in here so the no-context landing
 * page is reachable without a workspace.
 */
const NON_WORKSPACE_TOP_LEVEL = new Set([
  "login",
  "signup",
  "logout",
  "welcome",
  "onboarding",
  "pricing",
  "checkout",
  "invite",
  "docs",
  "privacy",
  "terms",
  "showcase",
  "workspaces",
]);

const PUBLIC_PREFIXES = ["/api/auth", "/auth", "/api/health", "/_next", "/favicon"];

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * True when the URL targets one of the non-workspace top-level paths.
 * Used by the root middleware to decide whether a missing-slug URL
 * should redirect (legacy → active slug) or pass through (it's a
 * marketing/auth page that has no workspace concept).
 */
export function isNonWorkspaceTopLevel(secondSegment: string | undefined): boolean {
  return !!secondSegment && NON_WORKSPACE_TOP_LEVEL.has(secondSegment);
}

/**
 * Phase D: split `/[locale]/[workspaceSlug]/rest...` into its parts.
 *
 * Returns `slug: null` when:
 *   - the URL has no locale at all (we'll let next-intl deal)
 *   - the second segment is one of the non-workspace top-level paths
 *     (auth, marketing, etc.) — the legacy-redirect logic in
 *     middleware.ts won't fire for those
 *   - the second segment doesn't look like a valid workspace slug
 *     (legacy URLs from before Phase D — caller redirects to the
 *     active slug or the workspaces list)
 *
 * `rest` is the remainder after `[locale]/[slug]`. It always starts
 * with `/` (or is `/` for the dashboard root).
 */
export function extractLocaleAndSlug(pathname: string): {
  locale: string | null;
  slug: string | null;
  rest: string;
} {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return { locale: null, slug: null, rest: "/" };
  const locale = LOCALE_RE.test(segments[0]!) ? segments[0]! : null;
  if (!locale) return { locale: null, slug: null, rest: "/" + segments.join("/") };

  const candidate = segments[1];
  // Skip the non-workspace top-level paths so we don't accidentally
  // try to interpret e.g. `/en/login` as a `login`-slug workspace.
  if (candidate && NON_WORKSPACE_TOP_LEVEL.has(candidate)) {
    return { locale, slug: null, rest: "/" + segments.slice(1).join("/") };
  }
  const isSlug = candidate ? SLUG_RE.test(candidate) : false;
  if (isSlug) {
    const restSegs = segments.slice(2);
    return {
      locale,
      slug: candidate ?? null,
      rest: restSegs.length ? "/" + restSegs.join("/") : "/",
    };
  }
  return { locale, slug: null, rest: "/" + segments.slice(1).join("/") };
}

/**
 * Resolves tenant context from the request and applies it.
 * In Phase B, the slug comes from cookie `orch-active-workspace`.
 * In Phase D, it will come from the URL path.
 */
export async function resolveTenantForRequest(req: NextRequest): Promise<{
  tenantId: string | null;
  slug: string | null;
}> {
  // Phase B: cookie-based active workspace
  const activeSlug = req.cookies.get("orch-active-workspace")?.value ?? null;
  if (!activeSlug) return { tenantId: null, slug: null };

  // Avoid importing resolveBySlug here to keep middleware light
  // (Edge runtime constraints). Instead resolve in handlers.
  return { tenantId: null, slug: activeSlug };
}
