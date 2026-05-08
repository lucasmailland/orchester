import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { extractLocalePath, isProtectedPath } from "./lib/middleware-utils";

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
    "connect-src 'self' https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com https://slack.com https://api.telegram.org" + (isDev ? " ws: wss:" : ""),
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
    // Caso especial: si el unauth visita la raíz, mostramos el landing público
    // en lugar de mandarlos a login. Para todo lo demás (rutas internas) sí
    // pedimos login con callback para volver después.
    if (localePath === "/") {
      return NextResponse.redirect(new URL(`/${locale}/welcome`, request.url));
    }
    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Pasamos al middleware de next-intl con headers extendidos para que el
  // nonce esté disponible en los Server Components vía `headers()`.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = intlMiddleware({
    ...request,
    headers: requestHeaders,
  } as NextRequest);

  // Inyectamos el nonce al CSP en la response.
  if (response) {
    response.headers.set("Content-Security-Policy", buildCsp(nonce, isDev));
    response.headers.set("x-nonce", nonce);
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|widget|c).*)",
  ],
};
