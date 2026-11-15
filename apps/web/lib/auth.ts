import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";
import { and, eq, gt, sql } from "drizzle-orm";
import { createDbClient, schema } from "@orchester/db";
import { resolveAuthSecret } from "@/lib/auth-secret";
import { assertSignupAllowed, getSignupMode, SignupNotAllowedError } from "@/lib/signup-policy";

async function hasPendingInvite(email: string): Promise<boolean> {
  // The invite belongs to a workspace the new user is not in yet, and
  // workspace_invite is FORCE RLS, so the lookup has to cross tenants.
  const { withCrossTenantAdmin } = await import("@/lib/tenant/cron");
  return withCrossTenantAdmin("signup.invite-check", async (tx) => {
    const rows = await tx
      .select({ id: schema.workspaceInvites.id })
      .from(schema.workspaceInvites)
      .where(
        and(
          eq(sql`lower(${schema.workspaceInvites.email})`, email),
          eq(schema.workspaceInvites.status, "pending"),
          gt(schema.workspaceInvites.expiresAt, new Date())
        )
      )
      .limit(1);
    return rows.length > 0;
  });
}

function getAuthDb() {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required for auth");
  return createDbClient(url);
}

export const auth = betterAuth({
  secret: resolveAuthSecret(),
  baseURL:
    process.env["BETTER_AUTH_URL"] ?? process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3001",
  database: drizzleAdapter(getAuthDb(), {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      twoFactor: schema.twoFactors,
    },
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  // Sign-in does not wait for it, but a proven address is what the system-admin
  // allowlist (lib/rbac.ts) relies on, so every email account gets the link.
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const { sendEmail } = await import("@/lib/email");
      await sendEmail({
        to: user.email,
        subject: "Confirm your email for Orchester",
        text: `Confirm this address to finish setting up your account:\n\n${url}\n\nIf you did not create an account, ignore this email.`,
      });
    },
  },
  socialProviders: {
    ...(process.env["GOOGLE_CLIENT_ID"] && process.env["GOOGLE_CLIENT_SECRET"]
      ? {
          google: {
            clientId: process.env["GOOGLE_CLIENT_ID"],
            clientSecret: process.env["GOOGLE_CLIENT_SECRET"],
          },
        }
      : {}),
  },
  databaseHooks: {
    user: {
      create: {
        // Runs before ANY user row is created — email signup and the first
        // sign-in with a social provider — so SIGNUP_MODE gates both.
        before: async (user) => {
          try {
            await assertSignupAllowed(
              user.email,
              getSignupMode(process.env["SIGNUP_MODE"]),
              hasPendingInvite
            );
          } catch (e) {
            if (e instanceof SignupNotAllowedError) {
              throw new APIError("FORBIDDEN", { message: e.message });
            }
            throw e;
          }
          return { data: user };
        },
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh daily
    // PERF-8: cache the session in a short-lived signed cookie so most
    // navigations skip the session-table lookup. 5 min is short enough that
    // revocation/role changes propagate quickly.
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
  },
  trustedOrigins: [
    process.env["BETTER_AUTH_URL"] ?? process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3001",
  ],
  user: {
    additionalFields: {
      onboardingCompleted: {
        type: "boolean",
        defaultValue: false,
      },
      preferredLocale: {
        type: "string",
        defaultValue: "en",
      },
    },
  },
  /**
   * Plugins habilitados:
   *   - twoFactor: TOTP (RFC 6238) + recovery codes. UI de setup en
   *     /settings#account → "Activar 2FA". Genera otpauth:// URL para
   *     escanear con Authenticator/Authy/1Password.
   *
   *     Issuer = "Orchester" (lo que ven en la app del autenticador).
   *     Backup codes: 10 códigos one-shot que el user guarda en algún
   *     lado seguro. Se regeneran cuando se rota el secret.
   */
  plugins: [
    twoFactor({
      issuer: "Orchester",
      // skipVerificationOnEnable=false → al activar el plugin, el user tiene
      // que probar un código antes de que el flag quede activo. Evita que un
      // user "active 2FA" sin terminar y se quede locked-out.
      skipVerificationOnEnable: false,
    }),
  ],
});

export type Auth = typeof auth;
