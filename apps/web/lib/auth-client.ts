import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const authClient: any = createAuthClient({
  baseURL:
    process.env["NEXT_PUBLIC_APP_URL"] ??
    (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"),
  plugins: [twoFactorClient()],
});

export const {
  signIn,
  signOut,
  signUp,
  useSession,
  getSession,
} = authClient;
