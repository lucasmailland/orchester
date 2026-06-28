-- 0012_fase2.sql — Fase 2 "features fantasma → reales".
--
-- COST-9: Stripe webhook idempotency. `stripe_event` persists every
-- processed Stripe event.id so redeliveries (Stripe retries until 2xx)
-- don't re-run subscription mutations. Plus a `past_due` flag on
-- workspace_billing so invoice.payment_failed can mark a tenant past-due
-- instead of leaving the plan silently active.
CREATE TABLE IF NOT EXISTS "stripe_event" (
  "id" text PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "workspace_id" text,
  "processed_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "workspace_billing"
  ADD COLUMN IF NOT EXISTS "past_due" boolean DEFAULT false NOT NULL;
