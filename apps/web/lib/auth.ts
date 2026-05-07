import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";
import { createDbClient, schema } from "@orchester/db";

function getAuthDb() {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required for auth");
  return createDbClient(url);
}

export const auth = betterAuth({
  secret: process.env["BETTER_AUTH_SECRET"] ?? "dev-secret-change-in-production",
  baseURL: process.env["BETTER_AUTH_URL"] ?? process.env["NEXT_PUBLIC_APP_URL"] ?? "http://localhost:3001",
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
