-- packages/db/migrations/0054_pgboss_schema_grant.sql
-- NOTE: requires superuser to execute (GRANT ... ON DATABASE).
--
-- pg-boss administra su propio schema `pgboss` y lo crea en el primer arranque
-- con `CREATE SCHEMA IF NOT EXISTS`. Ninguna migración de este repo lo crea, y
-- 0007_postgres_roles.sql sólo concede CONNECT sobre la base — no CREATE.
--
-- Resultado sin este grant: el worker entra en crash loop con
--
--     [worker] fatal: error: permission denied for database orchester
--     code: '42501'  routine: 'aclcheck_error'
--     at Contractor.create → PgBoss.start → preCreateAllQueues
--
-- Precrear el schema a mano NO alcanza: Postgres evalúa el privilegio CREATE
-- sobre la base ANTES de cortocircuitar por el IF NOT EXISTS, así que la
-- sentencia falla aunque el schema ya exista. Verificado sobre el deploy real:
-- con `CREATE SCHEMA pgboss AUTHORIZATION app_user` + `GRANT ALL ON SCHEMA`
-- el worker seguía fallando; recién con el GRANT de abajo levantó healthy.
--
-- Alcance del privilegio: CREATE sobre una base dedicada permite crear schemas
-- dentro de ESA base. No da acceso a otras bases ni escala a superusuario.
-- Es el requisito estándar de pg-boss para el rol de la aplicación.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE format('GRANT CREATE ON DATABASE %I TO app_user', current_database());
  END IF;
END$$;
