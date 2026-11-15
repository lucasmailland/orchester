-- packages/db/migrations/0069_two_factor_lockout.sql
--
-- better-auth 1.7 locks a TOTP factor after repeated failed codes and keeps
-- the count and the lock on the two_factor row. Its drizzle adapter checks the
-- schema at startup and refuses every auth request ("Drizzle schema mismatch")
-- while these columns are missing, so this has to be applied before the app
-- running 1.7 starts. Both are nullable / defaulted: existing factors start
-- unlocked with zero failures.
ALTER TABLE "two_factor" ADD COLUMN IF NOT EXISTS "failed_verification_count" integer DEFAULT 0;
ALTER TABLE "two_factor" ADD COLUMN IF NOT EXISTS "locked_until" timestamp;
