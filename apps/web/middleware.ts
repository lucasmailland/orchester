import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { extractLocalePath, isProtectedPath } from "./lib/middleware-utils";
import {
  extractLocaleAndSlug,
  isNonWorkspaceTopLevel,
  resolveTenantForRequest,
} from "./lib/tenant/middleware";
import { verifySigned } from "./lib/cookies";

const intlMiddleware = createMiddleware(routing);

/**
 * CSP nonce: generamos uno único por request y lo inyectamos en:
 *   - el header `Content-Security-Policy` con `'nonce-XXX'`
 *   - el header `x-nonce` que los Server Components pueden leer y pasar a
 *     `<Script nonce={nonce}>` o `<style nonce={nonce}>`
 *
 * Resultado: scripts/styles inline producidos por Next.js NO ejecutan a menos
 * que tengan el nonce de esta request → previene XSS reflejado.
 *
 * Trade-off conocido: framer-motion + recharts + heroui inyectan algunos
 * styles inline sin nonce. Para que NO rompan, mantenemos `'unsafe-inline'`
 * en `style-src` (no en `script-src`). Los browsers ignoran `'unsafe-inline'`
 * cuando hay nonce presente, así que en navegadores que respetan CSP3 los
 * styles inline sin nonce siguen rompiendo. Si te molesta, migrá a
 * tailwind/CSS-modules y removelo.
 */
function generateNonce(): string {
  // Web Crypto en edge runtime — no usar Node `crypto` acá.
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr));
}

function buildCsp(nonce: string, isDev: boolean): string {
  const directives: string[] = [
    "default-src 'self'",
    // Scripts: nonce + strict-dynamic permite que scripts con nonce carguen
    // otros scripts. En dev, Next.js + HMR necesitan unsafe-eval.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${isDev ? "'unsafe-eval'" : ""}`.trim(),
    // Styles: framer-motion/recharts inyectan inline → unsafe-inline acá es
    // necesario hasta que migremos.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com https://slack.com https://api.telegram.org" +
      (isDev ? " ws: wss:" : ""),
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ];
  return directives.join("; ");
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const isStatic = pathname.startsWith("/_next/") || pathname === "/favicon.ico";

  // Defense-in-depth: unconditionally drop any inbound `x-tenant-slug`
  // header from the incoming request. We compute the tenant slug
  // server-side from the signed session cookie further down and re-set
  // the header from that trusted source. If we left the attacker-
  // supplied value in place when the cookie is missing (no session, or
  // session without an active workspace) it would survive into the
  // forwarded request → server components / route handlers reading
  // `x-tenant-slug` could be tricked into scoping queries to an
  // arbitrary slug.
  if (request.headers.has("x-tenant-slug")) {
    request.headers.delete("x-tenant-slug");
  }

  // Generamos nonce SIEMPRE para HTML responses; APIs y assets no lo necesitan
  // (no devuelven HTML).
  const nonce = isApi || isStatic ? "" : generateNonce();
  const isDev = process.env.NODE_ENV !== "production";

  if (isApi || pathname.startsWith("/widget") || pathname.startsWith("/c/") || isStatic) {
    return NextResponse.next();
  }

  const localePath = extractLocalePath(pathname);
  const locale = pathname.match(/^\/(en|pt-BR|es)/)?.[1] ?? "en";

  const sessionToken =
    request.cookies.get("better-auth.session_token")?.value ??
    request.cookies.get("__Secure-better-auth.session_token")?.value;

  const hasSession = Boolean(sessionToken);

  if (isProtectedPath(localePath) && !hasSession) {
    // La raíz `/[locale]` sirve la landing pública (Server Component que
    // decide redirect→/workspaces si hay sesión). El middleware no debe
    // forzar redirect aquí — dejá que la page resuelva.
    if (localePath === "/") {
      return NextResponse.next();
    }
    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Phase D: legacy URL redirect. After we moved the shell layout
  // under `[workspaceSlug]`, requests for the pre-Phase-D URLs
  // (`/en/agents`, `/en/conversations`, …) need to land on the active
  // workspace's slug (`/en/<slug>/agents`). Logged-in users with a
  // workspace cookie get a 301 (legacy URLs are bookmarked +
  // shareable, so caching is desirable). Users without an active
  // workspace go to /workspaces to pick one.
  //
  // The non-workspace top-level paths (login, welcome, pricing, …)
  // are skipped — `extractLocaleAndSlug` already filters them, but
  // the explicit isNonWorkspaceTopLevel check keeps the intent
  // legible.
  if (hasSession && !isApi && !isStatic) {
    const parsed = extractLocaleAndSlug(pathname);
    const segments = pathname.split("/").filter(Boolean);
    const secondSeg = segments[1];
    if (
      parsed.locale &&
      !parsed.slug &&
      parsed.rest !== "/" &&
      !isNonWorkspaceTopLevel(secondSeg)
    ) {
      const rawCookie = request.cookies.get("orch-active-workspace")?.value;
      // Verify the HMAC tag before trusting the slug to build a
      // redirect URL — an unsigned/tampered cookie should be treated
      // as no cookie and fall through to the /workspaces picker.
      const activeSlug = rawCookie ? await verifySigned(rawCookie) : null;
      if (activeSlug) {
        const newPath = `/${parsed.locale}/${activeSlug}${parsed.rest}`;
        // 307 over 301: preserves the HTTP method on the redirect AND
        // is not aggressively cached by browsers / proxies the way 301
        // is. Legacy URLs change rarely but they DO change (workspace
        // rename, user switching workspaces) so a stale-forever cache
        // is a foot-gun.
        return NextResponse.redirect(new URL(newPath, request.url), 307);
      }
      return NextResponse.redirect(new URL(`/${parsed.locale}/workspaces`, request.url));
    }
  }

  // Next.js extrae el nonce del header `Content-Security-Policy` del REQUEST
  // que llega al renderer para aplicarlo a sus <script> inline de bootstrap/
  // hidratación. Si el renderer no ve ese header, los scripts quedan sin
  // nonce → el CSP (nonce + strict-dynamic, sin unsafe-inline) los bloquea →
  // la página NO hidrata (todo muerto en el browser aunque el SSR dé 200).
  //
  // next-intl arma su propia NextResponse y NO propaga los request headers
  // que seteamos (el viejo spread `{...request}` ni siquiera era válido). El
  // patrón correcto es `NextResponse.next({ request: { headers } })`. Así que:
  //   1. dejamos que next-intl calcule su decisión (redirect / rewrite / cookie)
  //   2. si es redirect (3xx) lo devolvemos tal cual (+CSP)
  //   3. si no, re-emitimos con `NextResponse.next({ request: { headers } })`
  //      forwardeando el CSP, y copiamos lo que next-intl haya seteado
  //      (set-cookie, rewrite de locale, etc.)
  const csp = buildCsp(nonce, isDev);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  // a11y-001: expose the URL-derived locale to the root layout so it can
  // render `<html lang={locale}>`. The root layout sits above the
  // `[locale]` segment and cannot read its `params`, so we forward the
  // value we already extracted at line 88.
  requestHeaders.set("x-locale", locale);

  // Phase B (tenant hardening): forward the active workspace slug from the
  // cookie into a header that server components / route handlers can read
  // without re-parsing cookies. The GUC itself is set later by
  // `getCurrentWorkspace()` once we resolve the workspace from the DB —
  // middleware runs on the Edge runtime and can't talk to Postgres.
  const { slug: tenantSlug } = await resolveTenantForRequest(request);
  if (tenantSlug) {
    requestHeaders.set("x-tenant-slug", tenantSlug);
  }

  const intlResponse = intlMiddleware(request);

  // Redirect de next-intl (ej. agrega prefijo de locale) → respetarlo.
  const status = intlResponse?.status ?? 200;
  if (status >= 300 && status < 400) {
    intlResponse.headers.set("Content-Security-Policy", csp);
    intlResponse.headers.set("x-nonce", nonce);
    return intlResponse;
  }

  // Caso normal: re-emitir con los request headers (incluido el CSP) para que
  // el renderer de Next vea el nonce. Preservamos el rewrite de locale y las
  // cookies que next-intl haya seteado.
  const rewriteUrl = intlResponse?.headers.get("x-middleware-rewrite");
  const response = rewriteUrl
    ? NextResponse.rewrite(new URL(rewriteUrl, request.url), {
        request: { headers: requestHeaders },
      })
    : NextResponse.next({ request: { headers: requestHeaders } });

  if (intlResponse) {
    intlResponse.headers.forEach((value, key) => {
      // No pisar los headers internos de control de Next.
      if (key === "x-middleware-rewrite" || key === "x-middleware-next") return;
      response.headers.set(key, value);
    });
    const setCookie = intlResponse.headers.get("set-cookie");
    if (setCookie) response.headers.set("set-cookie", setCookie);
  }
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("x-nonce", nonce);
  if (tenantSlug) {
    response.headers.set("x-tenant-slug", tenantSlug);
  }
  return response;
}

export const config = {
  // Skip:
  //   - `api`, `_next/*`, `favicon.ico`, `widget`, `c` (long-standing buckets)
  //   - any request that looks like a static asset (path ends in a typical
  //     asset extension). Without this last clause the next-intl middleware
  //     hits `/screenshots/foo.png` and tries to rewrite it to
  //     `/en/screenshots/foo.png`, which 404s — silently breaking every
  //     image served straight from `/public`.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|widget|c|.*\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|woff|woff2|ttf|otf|mp4|webm)).*)",
  ],
};
