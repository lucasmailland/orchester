# Environment Variables

> Every env var the app reads. Set in `.env.local` for dev, in your hosting
> provider for prod.

## Required (always)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. e.g. `postgresql://orchester:orchester@localhost:5432/orchester` |
| `BETTER_AUTH_SECRET` | Random 32+ char string; secures session cookies |
| `BETTER_AUTH_URL` | App's external URL. e.g. `http://localhost:3333` |
| `NEXT_PUBLIC_APP_URL` | Same URL, exposed to client (used for embed snippets, Telegram webhook URL) |
| `ENCRYPTION_SECRET` | 32-byte hex string. Generate: `openssl rand -hex 32`. AES-256-GCM key for AI provider keys + channel credentials. |

## Optional (gated features)

### Google OAuth
| Var | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |

### Email (Resend)
| Var | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend API key. If unset, emails are logged to console (dev). |
| `EMAIL_FROM` | Default From address. e.g. `Orchester <hello@orchester.io>` |

### Stripe (billing)
| Var | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` or `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` |
| `STRIPE_PRICE_STARTER` | Price ID for Starter plan |
| `STRIPE_PRICE_PRO` | Price ID for Pro plan |
| `STRIPE_PRICE_BUSINESS` | Price ID for Business plan |

### Sentry (errors)
| Var | Purpose |
|---|---|
| `SENTRY_DSN` | Project DSN. If unset, errors log to console. |

### Storage / mail (legacy)
| Var | Purpose |
|---|---|
| `STORAGE_DRIVER` | `local` (default) or `s3` |
| `STORAGE_LOCAL_PATH` | Path for local file storage |

## Verification

Before shipping a change, run:

```bash
pnpm --filter web tsc --noEmit
pnpm --filter web vitest run
```

The dev server prints which optional features it detects on boot.

## Adding a new env var
1. Read it via `process.env["NAME"]`.
2. Add to `.env.example` with a sensible default or `# generate with: ...`.
3. Add to this file with a short purpose line.
4. If it gates a feature, document the fallback behavior (no-op? throw?).
