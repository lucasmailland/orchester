import "server-only";
import { z } from "zod";

/**
 * Boot-time environment validation (audit A6-1).
 *
 * Node-only. Imported lazily from `instrumentation.ts#register()` so it never
 * ends up in the Edge bundle (middleware) — keep this module out of any code
 * path that the edge runtime can reach.
 *
 * `validateEnv()` parses `process.env` against a zod schema and, on failure,
 * throws ONE aggregated error listing every missing/invalid var so a
 * misconfigured deploy fails fast at boot instead of 500ing on first request.
 */

const hex64 = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, "must be a 64-char hex string (openssl rand -hex 32)");

export const envSchema = z.object({
  // ── Required ────────────────────────────────────────────────────────
  /** Postgres connection string. Used by the db package + better-auth. */
  DATABASE_URL: z.string().url("must be a valid connection URL"),
  /** better-auth signing secret. Also used to encrypt TOTP secrets. */
  BETTER_AUTH_SECRET: z.string().min(1, "is required"),
  /** AES-256-GCM primary key (version 1) for credential encryption. */
  ENCRYPTION_SECRET: hex64,

  // ── Optional ────────────────────────────────────────────────────────
  /** Public app URL (also used as auth baseURL fallback). */
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  /** Explicit better-auth base URL; falls back to NEXT_PUBLIC_APP_URL. */
  BETTER_AUTH_URL: z.string().url().optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).optional(),

  // Redis / rate-limit
  REDIS_URL: z.string().url().optional(),

  // Encryption key rotation (additional versioned keys)
  ENCRYPTION_KEYS: z.string().optional(),

  // OAuth (Google) — both required together or neither
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Email (Resend)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  // AI providers (per-workspace creds usually win; these are platform fallbacks)
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_AI_API_KEY: z.string().optional(),

  // Billing (Stripe)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_STARTER: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),
  STRIPE_PRICE_BUSINESS: z.string().optional(),

  // Storage
  STORAGE_DRIVER: z.string().optional(),
  STORAGE_LOCAL_PATH: z.string().optional(),

  // Observability
  SENTRY_DSN: z.string().optional(),

  // Deployment flags
  SELF_HOSTED: z.string().optional(),
  ALLOW_LOCAL_AI_PROVIDERS: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Validate `process.env` and return the typed env object.
 *
 * Throws an aggregated `Error` listing every problem if validation fails.
 * Result is cached after the first successful call.
 */
export function validateEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => {
        const key = i.path.join(".") || "(root)";
        return `  - ${key}: ${i.message}`;
      })
      .sort();
    throw new Error(
      `Invalid environment configuration — ${issues.length} problem(s):\n${issues.join(
        "\n"
      )}\n\nFix the above env vars and restart. See apps/web/lib/env.ts for the full schema.`
    );
  }

  cached = parsed.data;
  return cached;
}
