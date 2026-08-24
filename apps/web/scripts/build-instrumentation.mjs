// Compila los dos módulos que el hook de instrumentation importa con
// `/* webpackIgnore: true */`, y los deja donde el runtime los busca.
//
// POR QUÉ EXISTE
// -------------
// `instrumentation.ts` importa dos módulos Node-only de forma dinámica:
//
//     await import(/* webpackIgnore: true */ "./instrumentation-node");
//     await import(/* webpackIgnore: true */ "./lib/db-role-check");
//
// El `webpackIgnore` es necesario y está bien puesto: sin él, webpack sigue el
// string literal en build time —ignorando el early-return de NEXT_RUNTIME, que
// es sólo un chequeo de runtime— y arrastra postgres → perf_hooks al bundle de
// edge, que no tiene ese builtin. El build de edge falla.
//
// Pero el comentario de instrumentation.ts afirma que "in production the
// output-file tracer picks up the file through the dependency graph and copies
// it correctly". Eso NO pasa: `webpackIgnore: true` saca el módulo del grafo,
// que es precisamente su función, así que el tracer no tiene nada que seguir.
// Ni `.next/server/instrumentation-node.js` ni `.next/server/lib/db-role-check.js`
// se emiten nunca.
//
// Consecuencia, verificada sobre un deploy real hecho con deploy/Dockerfile:
// el `catch` de instrumentation.ts re-lanza cuando NODE_ENV=production, el hook
// de instrumentation falla en CADA request, y el servidor devuelve 500 en todo.
// El contenedor arranca ("Ready in 562ms") y queda unhealthy. Afecta a cualquiera
// que self-hostee con ese Dockerfile.
//
// LA SOLUCIÓN
// -----------
// Compilarlos aparte con esbuild y escribirlos en la ruta exacta que el import
// dinámico resuelve en runtime. Mismo patrón que worker/build.mjs, que ya
// resuelve un problema análogo para el bundle del worker.
//
// Correr DESPUÉS de `next build` — escribe dentro de .next/, que next build
// limpia al arrancar.

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const empty = path.join(webRoot, "worker", "empty-module.cjs");
// Dos destinos, y el segundo es el que importa en producción.
//
// deploy/Dockerfile copia `.next/standalone` a /app en la etapa runner, así que
// la ruta que el import dinámico resuelve dentro del contenedor
// (/app/apps/web/.next/server/…) corresponde a
// .next/standalone/apps/web/.next/server/…, NO a .next/server/…
//
// `next build` arma el standalone copiando su propio árbol, y como estos dos
// módulos no existen cuando eso corre, hay que escribirlos en ambos lugares:
// .next/server para `next start` local, y el standalone para la imagen.
const outDirs = [path.join(webRoot, ".next", "server")];

const standaloneServer = path.join(
  webRoot,
  ".next",
  "standalone",
  "apps",
  "web",
  ".next",
  "server"
);
if (existsSync(path.dirname(standaloneServer))) outDirs.push(standaloneServer);

if (!existsSync(outDirs[0])) {
  console.error(
    "[instrumentation] no existe .next/server — corré `next build` antes que este script."
  );
  process.exit(1);
}

const SOURCES = [
  { entry: path.join(webRoot, "instrumentation-node.ts"), rel: "instrumentation-node.mjs" },
  {
    entry: path.join(webRoot, "lib", "db-role-check.ts"),
    rel: path.join("lib", "db-role-check.mjs"),
  },
];

const TARGETS = outDirs.flatMap((d) =>
  SOURCES.map(({ entry, rel }) => ({ entry, out: path.join(d, rel) }))
);

for (const { entry, out } of TARGETS) {
  if (!existsSync(entry)) {
    console.error(`[instrumentation] no encuentro el fuente: ${entry}`);
    process.exit(1);
  }

  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    platform: "node",
    // Salida .mjs — ESM inequívoco, sin depender del `"type"` del package.json
    // más cercano (el standalone de Next no declara ninguno, así que un `.js`
    // se interpreta como CommonJS y da "Cannot use import statement outside a
    // module").
    //
    // CJS no es alternativa: instrumentation-node.ts usa top-level await y
    // esbuild no lo soporta con `format: "cjs"`.
    //
    // instrumentation.ts los importa por variable, no por literal, para que
    // TypeScript no intente resolver el `.mjs` (lo mapearía a `.mts`, y el
    // fuente es `.ts`).
    format: "esm",
    target: "node22",
    external: ["pg-native"],
    // Los markers de server-only/client-only sólo tienen sentido dentro del
    // bundler de Next; fuera tiran. Mismo alias que usa worker/build.mjs.
    alias: { "server-only": empty, "client-only": empty },
    tsconfig: path.join(webRoot, "tsconfig.json"),
    logLevel: "error",
    banner: {
      js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
    },
  });

  console.log(
    `[instrumentation] ${path.relative(webRoot, entry)} → ${path.relative(webRoot, out)}`
  );
}
