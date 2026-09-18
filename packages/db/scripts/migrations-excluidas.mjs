/**
 * Las migraciones que NO se aplican, y por qué.
 *
 * Vivían en un comentario del encabezado de `apply-sql-migrations.mjs`. Un
 * comentario no se puede consultar: el auditor no sabe distinguir "decidimos
 * no aplicarla" de "se nos pasó", que es exactamente la diferencia que importa.
 *
 * Toda migración forward tiene que estar en el MANIFEST o acá. Si no está en
 * ninguno, el auditor la reporta como huérfana — y eso es deliberado: dejar
 * una afuera en silencio es el mecanismo que produjo los desvíos que ya
 * encontramos.
 */
export const EXCLUIDAS = {
  "0008_rls_enable_no_force.sql":
    "RLS aísla ENTRE tenants; este deploy tiene uno solo. Obligatoria ANTES de cargar datos de una segunda organización.",
  "0009_rls_force_critical.sql": "Ver 0008: misma decisión single-tenant.",
  "0010_rls_force_rest.sql": "Ver 0008: misma decisión single-tenant.",
  "0011_rls_missing_tables.sql": "Ver 0008: sólo tiene sentido con RLS habilitado.",
  "0012_fix_workspace_select_policy.sql":
    "Ver 0008: corrige una política que no existe si RLS está apagado.",
  "0013_rls_legacy_template.sql": "Ver 0008: idem.",
};

/**
 * Prefijos de migraciones de arquitecturas retiradas.
 *
 * Las tablas `mnemo_*` y `brain_*` eran el motor de memoria en proceso.
 * `src/schema/**` ya no las declara: orchester habla con Mnemosyne por HTTP.
 *
 * Ojo con filtrar sólo por nombre: `0036_mnemosyne_agent_memory_policy.sql` y
 * `0038_conversation_sensitivity.sql` se llaman "mnemosyne" pero agregan
 * columnas a `agent` y `conversation`, que son tablas vigentes. Por eso están
 * en el MANIFEST y ganan sobre esta regla.
 */
export const ARQUITECTURA_RETIRADA = /mnemosyne|mnemo_|brain/;
