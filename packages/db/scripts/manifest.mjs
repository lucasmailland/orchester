/**
 * Las migraciones que SÍ se aplican, en orden.
 *
 * Vive aparte para que el aplicador y el auditor lean la misma lista: dos
 * copias de esto divergen, y el día que divergen el auditor deja de servir.
 *
 * Lo que queda afuera a propósito está en `migrations-excluidas.mjs`, con su
 * motivo. Una migración que no esté en ninguno de los dos es un descuido, y el
 * auditor la reporta como tal.
 */
export const MANIFEST = [
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
  ["0055_flow_spec.sql", "columnas flow.spec y flow_version.spec (documentación del flujo)"],
  ["0056_channel_type_discord.sql", "valor `discord` en el enum channel_type"],
  ["0057_api_key_explicit_scopes.sql", "scopes explícitos en las api keys que ya existen"],
  // Sin número: ajuste del deploy single-tenant, no historia de upstream.
  // 0049 deja `org` con FORCE RLS y sólo una política de SELECT, así que ningún
  // INSERT pasa y crear un workspace da 500. Ver el header del archivo.
  ["single-tenant-org-rls-off.sql", "apaga RLS en `org` — 0049 la deja sin política de INSERT"],
];
