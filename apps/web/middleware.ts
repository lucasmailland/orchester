import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { extractLocalePath, isProtectedPath } from "./lib/middleware-utils";

const intlMiddleware = createMiddleware(routing);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/widget") ||
    pathname.startsWith("/c/") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const localePath = extractLocalePath(pathname);
  const locale = pathname.match(/^\/(en|pt-BR|es)/)?.[1] ?? "en";

  const sessionToken =
    request.cookies.get("better-auth.session_token")?.value ??
    request.cookies.get("__Secure-better-auth.session_token")?.value;

  const hasSession = Boolean(sessionToken);

  // Only redirect unauthenticated users away from protected pages.
  // Do NOT redirect from login→home based on cookie alone — the cookie may be
  // stale/invalid and would cause an ERR_TOO_MANY_REDIRECTS loop. The shell
  // layout already validates the session server-side and redirects to login
  // if invalid, so we let the shell handle the "already logged in" case.
  if (isProtectedPath(localePath) && !hasSession) {
    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|widget|c).*)",
  ],
};
