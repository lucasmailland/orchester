-- packages/db/migrations/0007_postgres_roles.down.sql

-- Reassign owned objects before drop (safe-ish, but in prod this is rare)
REASSIGN OWNED BY app_user TO postgres;
REASSIGN OWNED BY cron_admin TO postgres;
REASSIGN OWNED BY read_only_audit TO postgres;

DROP OWNED BY app_user;
DROP OWNED BY cron_admin;
DROP OWNED BY read_only_audit;

DROP ROLE IF EXISTS app_user;
DROP ROLE IF EXISTS cron_admin;
DROP ROLE IF EXISTS read_only_audit;
