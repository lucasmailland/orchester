-- COST-7: usage_event.cost_usd was nullable, so a single NULL row shrank the
-- spend-cap total (coalesce(sum(...)) drops NULLs) and unknown-capability
-- pricing wrote silent NULLs. Backfill, then enforce NOT NULL DEFAULT 0 so the
-- cap and billing always sum a real number.
UPDATE "usage_event" SET "cost_usd" = 0 WHERE "cost_usd" IS NULL;
ALTER TABLE "usage_event" ALTER COLUMN "cost_usd" SET DEFAULT 0;
ALTER TABLE "usage_event" ALTER COLUMN "cost_usd" SET NOT NULL;
