import "server-only";
import type { NextRequest } from "next/server";

const LOCALE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;

const PUBLIC_PREFIXES = ["/api/auth", "/auth", "/api/health", "/_next", "/favicon"];

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export function extractLocaleAndSlug(pathname: string): {
  locale: string | null;
  slug: string | null;
} {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return { locale: null, slug: null };
  const locale = LOCALE_RE.test(segments[0]!) ? segments[0]! : null;
  // Phase B: slug is NOT yet in URL. Returns null.
  // Phase D will populate this from segments[1].
  const slug = null;
  return { locale, slug };
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
