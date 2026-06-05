export const PROTECTED_PATHS = [
  "/",
  "/teams",
  "/agents",
  "/flows",
  "/org",
  "/conversations",
  "/employees",
  "/channels",
  "/integrations",
  "/usage",
  "/settings",
  "/onboarding",
  "/builder",
  "/runs",
];

export const AUTH_PATHS = ["/login", "/signup"];

export const PUBLIC_PATHS = ["/api", "/_next", "/favicon.ico", "/widget", "/c/", "/welcome"];

export function extractLocalePath(pathname: string): string {
  const match = pathname.match(/^\/(en|pt-BR|es)(\/.*)?$/);
  if (!match) return pathname;
  return match[2] ?? "/";
}

export function isProtectedPath(localePath: string): boolean {
  return PROTECTED_PATHS.some((p) => localePath === p || localePath.startsWith(p + "/"));
}

export function isAuthPath(localePath: string): boolean {
  return AUTH_PATHS.some((p) => localePath.startsWith(p));
}
