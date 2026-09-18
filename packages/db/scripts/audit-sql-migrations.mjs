#!/usr/bin/env node
/**
 * Compara lo que cada migración DEBERÍA haber creado contra lo que la base
 * tiene de verdad.
 *
 *     DATABASE_URL=postgresql://... node scripts/audit-sql-migrations.mjs [--json]
 *
 * **Por qué existe.** El encabezado de `apply-sql-migrations.mjs` dice que el
 * MANIFEST fue "verificado contra un deploy real comparando `src/schema/**`
 * contra `information_schema`". Esa verificación se hizo UNA VEZ, a mano, y es
 * justo lo que se desactualiza. Ya se desactualizó dos veces: `0055_flow_spec`
 * apareció aplicada sin estar registrada, y `0014` y `0015` quedaron afuera del
 * manifiesto sin que nadie dijera por qué.
 *
 * El registro `_applied_sql_migrations` sólo sabe lo que corrió POR EL RUNNER.
 * Una migración aplicada a mano queda sin registrar, y el registro pasa a
 * mentir en silencio — que es la peor forma de mentir de un registro.
 *
 * Esto NO reemplaza leer la migración. Detecta objetos que el SQL crea de forma
 * reconocible (tablas, columnas, funciones, roles, triggers, políticas, valores
 * de enum). Lo que no puede verificar lo dice, en vez de darlo por bueno.
 *
 * No escribe nada: es seguro contra producción.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MANIFEST } from "./manifest.mjs";
import { EXCLUIDAS, ARQUITECTURA_RETIRADA } from "./migrations-excluidas.mjs";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/**
 * Qué objetos crea un SQL, leyéndolo.
 *
 * Deliberadamente conservador: reconoce las formas que estas migraciones usan y
 * calla sobre el resto. Un extractor que adivina produce falsos "no aplicada"
 * que enseñan a ignorar el informe.
 */
function objetosQueCrea(sql) {
  const objetos = [];
  const limpio = sql.replace(/--[^\n]*/g, "");
  const buscar = (re, tipo, armar) => {
    for (const m of limpio.matchAll(re)) objetos.push({ tipo, ...armar(m) });
  };

  buscar(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi, "tabla", (m) => ({
    nombre: m[1],
  }));
  buscar(
    /ALTER\s+TABLE\s+"?(\w+)"?\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi,
    "columna",
    (m) => ({ tabla: m[1], nombre: m[2] })
  );
  buscar(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"?(\w+)"?/gi, "funcion", (m) => ({
    nombre: m[1],
  }));
  buscar(/CREATE\s+ROLE\s+"?(\w+)"?/gi, "rol", (m) => ({ nombre: m[1] }));
  buscar(/CREATE\s+TRIGGER\s+"?(\w+)"?/gi, "trigger", (m) => ({ nombre: m[1] }));
  buscar(/CREATE\s+POLICY\s+"?([\w-]+)"?\s+ON\s+"?(\w+)"?/gi, "politica", (m) => ({
    nombre: m[1],
    tabla: m[2],
  }));
  buscar(
    /ALTER\s+TYPE\s+(?:"?public"?\.)?"?(\w+)"?\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'/gi,
    "valor_enum",
    (m) => ({ tipo_enum: m[1], nombre: m[2] })
  );
  return objetos;
}

const CONSULTAS = {
  tabla: (o) => [`SELECT to_regclass($1) IS NOT NULL AS existe`, [o.nombre]],
  columna: (o) => [
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 AND column_name=$2) AS existe`,
    [o.tabla, o.nombre],
  ],
  funcion: (o) => [
    `SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname=$1) AS existe`,
    [o.nombre],
  ],
  rol: (o) => [`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=$1) AS existe`, [o.nombre]],
  trigger: (o) => [
    `SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname=$1) AS existe`,
    [o.nombre],
  ],
  politica: (o) => [
    `SELECT EXISTS (SELECT 1 FROM pg_policy WHERE polname=$1) AS existe`,
    [o.nombre],
  ],
  valor_enum: (o) => [
    `SELECT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
       WHERE t.typname=$1 AND e.enumlabel=$2) AS existe`,
    [o.tipo_enum, o.nombre],
  ],
};

const describir = (o) =>
  o.tipo === "columna"
    ? `${o.tabla}.${o.nombre}`
    : o.tipo === "valor_enum"
      ? `${o.tipo_enum}='${o.nombre}'`
      : o.nombre;

async function main() {
  const comoJson = process.argv.includes("--json");
  const url = process.env["DATABASE_URL"];
  if (!url) {
    console.error("audit-sql-migrations: falta DATABASE_URL");
    process.exit(2);
  }
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { max: 1, idle_timeout: 10, connect_timeout: 15 });

  try {
    const registradas = new Set(
      (await sql`SELECT filename FROM _applied_sql_migrations`.catch(() => [])).map(
        (r) => r.filename
      )
    );
    const enManifest = new Set(MANIFEST.map(([archivo]) => archivo));

    const archivos = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"))
      .sort();

    const hallazgos = [];
    for (const archivo of archivos) {
      const esperada = enManifest.has(archivo);
      const excluida = EXCLUIDAS[archivo];
      const retirada = !esperada && !excluida && ARQUITECTURA_RETIRADA.test(archivo);
      if (retirada) continue;

      const objetos = objetosQueCrea(readFileSync(join(MIGRATIONS_DIR, archivo), "utf8"));
      const presentes = [];
      const ausentes = [];
      for (const o of objetos) {
        const armar = CONSULTAS[o.tipo];
        if (!armar) continue;
        const [texto, params] = armar(o);
        const [fila] = await sql.unsafe(texto, params);
        (fila?.existe ? presentes : ausentes).push(describir(o));
      }

      const verificable = presentes.length + ausentes.length > 0;
      const aplicada = verificable ? ausentes.length === 0 : null;

      let estado;
      if (!esperada && excluida) estado = aplicada === true ? "excluida-pero-aplicada" : "excluida";
      else if (!esperada) estado = "huerfana";
      else if (aplicada === null) estado = "no-verificable";
      else if (aplicada && registradas.has(archivo)) estado = "ok";
      else if (aplicada) estado = "aplicada-sin-registrar";
      else if (registradas.has(archivo)) estado = "registrada-pero-ausente";
      else estado = "pendiente";

      hallazgos.push({ archivo, estado, presentes, ausentes, motivo: excluida ?? null });
    }

    if (comoJson) {
      console.log(JSON.stringify({ hallazgos }, null, 2));
    } else {
      const por = (e) => hallazgos.filter((h) => h.estado === e);
      const contar = (e) => por(e).length;
      console.log(
        `${hallazgos.length} migraciones revisadas: ${contar("ok")} en orden, ` +
          `${contar("excluida")} excluidas a propósito, ${contar("no-verificable")} sin objetos que comprobar.\n`
      );
      const problemas = [
        [
          "registrada-pero-ausente",
          "REGISTRADA PERO SUS OBJETOS NO ESTÁN — el registro dice que corrió y la base dice que no",
        ],
        ["pendiente", "EN EL MANIFIESTO Y SIN APLICAR — el runner no llegó a correrla"],
        ["huerfana", "NI EN EL MANIFIESTO NI EXPLICADA — nadie sabe si se dejó afuera a propósito"],
        [
          "aplicada-sin-registrar",
          "APLICADA A MANO — está en la base pero el registro no la tiene",
        ],
        ["excluida-pero-aplicada", "EXCLUIDA PERO PRESENTE — alguien la aplicó igual"],
      ];
      for (const [estado, titulo] of problemas) {
        const lista = por(estado);
        if (lista.length === 0) continue;
        console.log(`${titulo}:`);
        for (const h of lista) {
          const falta = h.ausentes.length ? `  falta: ${h.ausentes.join(", ")}` : "";
          console.log(`  ${h.archivo}${falta}`);
        }
        console.log("");
      }
      const total = problemas.reduce((n, [e]) => n + contar(e), 0);
      console.log(
        total === 0
          ? "Sin desvíos."
          : `${total} desvío(s) — cada uno necesita una decisión, no un arreglo automático.`
      );
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(2);
});
