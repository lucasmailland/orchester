import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { extractLocalePath, isAuthPath, isProtectedPath } from "./lib/middleware-utils";

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

  if (isProtectedPath(localePath) && !hasSession) {
    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthPath(localePath) && hasSession) {
    return NextResponse.redirect(new URL(`/${locale}`, request.url));
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|widget|c).*)",
  ],
};
