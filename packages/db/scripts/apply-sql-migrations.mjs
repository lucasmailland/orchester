#!/usr/bin/env node
/**
 * Runner idempotente para los SQL escritos a mano de packages/db/migrations/.
 *
 * POR QUÉ EXISTE
 * --------------
 * El repo tiene DOS juegos de migraciones y hasta ahora sólo uno se aplicaba:
 *
 *   packages/db/drizzle/      2 archivos (0000_baseline + 0001_indexes).
 *                             Es el `out:` de drizzle.config.ts, o sea lo único
 *                             que corre `drizzle-kit migrate`.
 *   packages/db/migrations/   52 SQL forward. Roles, RLS, y varias tablas y
 *                             columnas que el schema de drizzle SÍ declara.
 *                             No los aplicaba NADIE: ni un script en este
 *                             paquete, ni scripts/, ni CI.
 *
 * `docs/DEPLOY.md` dice aplicar "all drizzle migrations + hand-rolled SQL
 * migrations" pero el único comando que da es `drizzle-kit migrate`, que es la
 * primera mitad. Resultado verificado sobre un deploy real: 38 tablas, sin el
 * rol `app_user` (la app no conecta), 0 políticas RLS y 80 columnas del schema
 * ausentes en la base.
 *
 * QUÉ APLICA
 * ----------
 * El MANIFEST de abajo, en orden. No es la carpeta entera: es el subconjunto
 * verificado contra un deploy real comparando `src/schema/**` (fuente de verdad
 * de drizzle) contra `information_schema`. Cada entrada dice qué aporta.
 *
 * QUÉ NO APLICA, Y POR QUÉ
 * ------------------------
 *   - 0008 / 0009 / 0010 (RLS enable + policies + FORCE): decisión explícita
 *     para el deploy single-tenant de Fichap. RLS aísla ENTRE tenants; con un
 *     solo tenant no protege de nada. Las funciones helper (0006) SÍ se aplican
 *     para poder habilitarlo después sin volver a tocar esto.
 *     ⚠ Si este deploy alguna vez sirve a más de una organización, estos tres
 *       archivos pasan a ser obligatorios ANTES de cargar datos de la segunda.
 *   - Las migraciones que crean tablas `mnemo_*` y `brain_*`: son el motor de
 *     memoria EN PROCESO, arquitectura retirada en Phase 3/4. `src/schema/**`
 *     ya no las declara, o sea el código actual no las toca. Orchester habla
 *     con Mnemosyne por HTTP (ver apps/web/lib/mnemo/client.ts).
 *
 * OJO con filtrar por nombre: 0036_mnemosyne_agent_memory_policy.sql y
 * 0038_conversation_sensitivity.sql se llaman "mnemosyne" pero agregan columnas
 * a `agent` y `conversation`, que son tablas vigentes. Van en el MANIFEST.
 *
 * USO
 * ---
 *   DATABASE_URL=postgresql://<superuser>:<pw>@host:5432/orchester \
 *     node packages/db/scripts/apply-sql-migrations.mjs [--dry-run]
 *
 * Requiere SUPERUSUARIO: 0007 hace CREATE ROLE y GRANT.
 * Idempotente: registra lo aplicado en `_applied_sql_migrations` y saltea.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/** Orden importa: 0007 hace REVOKE sobre audit_log y security_event, así que
 *  0002b y 0005 tienen que haber corrido antes. */
const MANIFEST = [
  [
    "0001_workspace_lifecycle.sql",
    "8 columnas de lifecycle en `workspace` (suspend/delete/restore)",
  ],
  ["0002a_rename_legacy_audit_log.sql", "renombra la audit_log vieja a audit_log_legacy"],
  ["0002b_audit_log.sql", "audit_log nueva, con cadena de hashes (seq/prev_hash/chain_hash)"],
  ["0002c_audit_log_data_migration.sql", "migra los datos de la legacy a la nueva"],
  ["0003_feature_flags.sql", "tabla feature_flag"],
  ["0004_gdpr_export_jobs.sql", "tabla gdpr_export_job"],
  ["0005_idempotency_security.sql", "tablas idempotency_key y security_event"],
  ["0006_rls_helpers.sql", "funciones current_workspace_id() e is_cross_tenant_admin()"],
  ["0007_postgres_roles.sql", "roles app_user / cron_admin / read_only_audit + grants"],
  ["0036_mnemosyne_agent_memory_policy.sql", "columna agent.memory_policy"],
  ["0038_conversation_sensitivity.sql", "columna conversation.memory_learning_paused"],
  ["0049_org_primitive.sql", "tabla org + columna workspace.org_id"],
  ["0054_pgboss_schema_grant.sql", "GRANT CREATE ON DATABASE — pg-boss crea su propio schema"],
  // Sin número: ajuste del deploy single-tenant, no historia de upstream.
  // 0049 deja `org` con FORCE RLS y sólo una política de SELECT, así que ningún
  // INSERT pasa y crear un workspace da 500. Ver el header del archivo.
  ["single-tenant-org-rls-off.sql", "apaga RLS en `org` — 0049 la deja sin política de INSERT"],
];

const url = process.env["DATABASE_URL"];
if (!url) {
  console.error("apply-sql-migrations: falta DATABASE_URL (conexión de SUPERUSUARIO)");
  process.exit(1);
}

const dryRun = process.argv.includes("--dry-run");

const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1, idle_timeout: 10, connect_timeout: 15 });

let applied = 0;
let skipped = 0;

try {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS _applied_sql_migrations (
      filename    text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);

  const rows = await sql`SELECT filename FROM _applied_sql_migrations`;
  const done = new Set(rows.map((r) => r.filename));

  for (const [file, what] of MANIFEST) {
    if (done.has(file)) {
      console.log(`  skip   ${file}  (ya aplicada)`);
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`  DRY    ${file}  → ${what}`);
      continue;
    }

    const body = readFileSync(join(MIGRATIONS_DIR, file), "utf8");

    // Cada archivo va en su propia transacción: si uno falla, los anteriores
    // quedan aplicados y registrados, y se puede reintentar desde ahí.
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO _applied_sql_migrations (filename) VALUES (${file})`;
      });
      console.log(`  apply  ${file}  → ${what}`);
      applied++;
    } catch (err) {
      console.error(`\n  FALLÓ  ${file}`);
      console.error(`  ${err.message}\n`);
      throw err;
    }
  }

  console.log(`\n[apply-sql-migrations] Listo. Aplicadas: ${applied}, ya estaban: ${skipped}.`);
  if (!dryRun) {
    console.log(
      "RLS NO se habilitó (deploy single-tenant). Si esto pasa a multi-tenant,\n" +
        "aplicar 0008 + 0009 + 0010 ANTES de cargar datos de una segunda organización."
    );
  }
} finally {
  await sql.end({ timeout: 5 });
}
