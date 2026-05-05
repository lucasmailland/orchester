# Billing

**Files:**
- `apps/web/lib/billing/{plans,quotas,stripe}.ts`
- `apps/web/app/api/billing/{checkout,portal,webhook,usage}/route.ts`
- `apps/web/components/settings/BillingSection.tsx`
- Schema: `usage_event`, `workspace_billing` (in `production.ts`)

**Owner:** billing
**Status:** scaffolded — works once Stripe keys are provisioned

## Purpose
5-tier subscription with Stripe Checkout + Customer Portal. Quotas enforced
based on monthly usage events.

## Planning (initial design)

### Plans
| Plan | Price/mo | Agents | Flows | Convs | Tokens | Members | KBs |
|---|---|---|---|---|---|---|---|
| Free | $0 | 3 | 3 | 100 | 50K | 1 | 1 |
| Starter | $29 | 10 | 10 | 1K | 500K | 3 | 5 |
| Pro | $99 | 50 | 50 | 10K | 5M | 10 | 25 |
| Business | $399 | ∞ | ∞ | 100K | 50M | 50 | ∞ |
| Enterprise | custom | ∞ | ∞ | ∞ | ∞ | ∞ | ∞ |

### Endpoints
- `POST /api/billing/checkout` body `{ plan: "starter"|"pro"|"business" }` →
  Stripe Checkout URL. Resolves the price from env: `STRIPE_PRICE_STARTER`,
  `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS`.
- `POST /api/billing/portal` → Customer Portal URL (manage / cancel).
- `POST /api/billing/webhook` (Stripe webhook receiver):
  - Verifies signature with `STRIPE_WEBHOOK_SECRET`.
  - On `checkout.session.completed` / `customer.subscription.updated`:
    upserts `workspace_billing` (plan, customer, subscription, period end).
  - On `customer.subscription.deleted`: downgrade to `free`.
- `GET /api/billing/usage` → `{ plan, planMeta, usage, limits }` for the
  Settings UI.

### Stripe wrapper
- `lib/billing/stripe.ts` — minimal REST wrapper, no SDK (keeps cold-starts
  fast). `createCheckoutSession` and `createBillingPortalSession`.
- All requests go through `STRIPE_SECRET_KEY`.

### Quotas
- `getMonthlyUsage(workspaceId)` aggregates `usage_event` for the current UTC
  month, grouped by `kind`.
- `checkQuota(workspaceId, kind)` → `{ allowed, limit?, current?, reason? }`.
- Used pre-check in heavy endpoints (test-chat, flow runs).

### Usage events
Emitted on:
- Each agent_message in `lib/channels/router.ts`.
- (Future) flow_run, kb_query, webhook_call.

### Decisions & trade-offs
- **Stripe REST not SDK** — saves ~200 KB bundle.
- **Webhook signature uses simple HMAC-SHA256** matching Stripe's `t=,v1=`
  format. We do NOT call `stripe.webhooks.constructEvent` because no SDK.
- **Free plan starts everyone**; row in `workspace_billing` is created
  lazily on first paid subscription.

## Execution (changelog — newest first)

### 2026-04-28 — Phase 7
- 3 new tables (usage_event, workspace_billing, plan enum).
- Stripe wrapper + 4 endpoints.
- BillingSection UI in Settings with usage progress bars.

## Performance notes
- Usage queries indexed on `(workspace_id, created_at DESC)`.
- `getCachedDashboard` doesn't include billing; that's fetched separately.

## Open issues / TODO
- Hook `checkQuota` into hot paths: BLOCK requests when over.
- Soft warning at 80% via banner.
- Prorations / mid-cycle upgrades (Stripe handles, just trigger via Portal).
- Enterprise plan: contact-sales flow with sales@orchester.io email handoff.
- Annual pricing (today only monthly).
