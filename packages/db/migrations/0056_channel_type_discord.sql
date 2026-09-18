-- packages/db/migrations/0056_channel_type_discord.sql
--
-- Adds the `discord` channel kind, for the slash-command interactions endpoint.
-- Since PostgreSQL 12 this may run inside a transaction as long as the new
-- value is not used before the transaction commits, which is the case here.
ALTER TYPE channel_type ADD VALUE IF NOT EXISTS 'discord';
