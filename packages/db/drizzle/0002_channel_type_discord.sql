-- Adds the `discord` channel kind, for the slash-command interactions endpoint.
--
-- Hand-written, like 0001: `drizzle-kit generate` cannot be used here because
-- the committed snapshot has drifted from the schema in unrelated places and
-- would emit that drift too.
--
-- Since PostgreSQL 12 this may run inside a transaction as long as the new
-- value is not used before the transaction commits, which is the case here.
ALTER TYPE "public"."channel_type" ADD VALUE IF NOT EXISTS 'discord';
