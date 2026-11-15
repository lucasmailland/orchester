-- packages/db/migrations/0066_stripe_event_and_past_due.sql
--
-- Stripe redelivers webhooks. stripe_event keeps every processed event id so a
-- redelivery is a no-op instead of applying the same plan change twice. It holds
-- no tenant data (ids and types only) and is read through withCrossTenantAdmin,
-- so it has no RLS.
--
-- workspace_billing.past_due records that the last invoice failed, so the app
-- can say so instead of only finding out when the plan is downgraded.
CREATE TABLE IF NOT EXISTS "stripe_event" (
  "id" text PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "workspace_id" text,
  "processed_at" timestamp DEFAULT now() NOT NULL
);
ALTER TABLE "workspace_billing" ADD COLUMN IF NOT EXISTS "past_due" boolean DEFAULT false NOT NULL;
