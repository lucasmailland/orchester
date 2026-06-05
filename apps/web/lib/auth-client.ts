import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

// IMPORTANT: in the browser the auth client must hit the same origin
// the page was served from. A stale `NEXT_PUBLIC_APP_URL` (e.g. the dev
// server moved ports, prod env leaked into dev) used to silently break
// sign-in with `Failed to fetch` — there's literally nothing listening
// at the stale URL. So in browser we ALWAYS use `window.location.origin`
// and only honor the env var server-side (SSR/RSC fetches need an
// absolute URL because there's no `window`).
const baseURL =
  typeof window !== "undefined"
    ? window.location.origin
    : (process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3333");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const authClient: any = createAuthClient({
  baseURL,
  plugins: [twoFactorClient()],
});

export const { signIn, signOut, signUp, useSession, getSession } = authClient;
