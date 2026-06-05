// Bundlea el worker a un único ESM con esbuild y lo corre con node puro.
//
// Por qué no tsx: el bridge CJS de tsx dispara ERR_REQUIRE_CYCLE_MODULE en
// Node ≥22 por el grafo queue↔flow-engine↔webhooks-out, y además choca con
// el `throw` de `server-only`. esbuild resuelve ambos de raíz:
//   - alias server-only/client-only → módulo vacío (markers no aplican fuera
//     del bundler de Next)
//   - packages:external → node_modules se resuelven en runtime (pg-boss, etc.)
//   - tsconfig paths (@/...) resueltos por esbuild
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const empty = path.join(here, "empty-module.cjs");

// Bundle full: workspace packages son TS sin build y sus deps viven en
// node_modules de cada paquete (pnpm), así que externalizar rompe la
// resolución desde .dist/. Las deps en juego (postgres, drizzle-orm, pg-boss,
// cuid2, better-auth utils) son JS puro → bundlear todo es lo más robusto.
// Sólo `pg-native` (opcional de pg, binario) se marca external por si acaso.
await build({
  entryPoints: [path.join(here, "index.ts")],
  outfile: path.join(here, ".dist", "worker.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["pg-native"],
  alias: { "server-only": empty, "client-only": empty },
  tsconfig: path.join(webRoot, "tsconfig.json"),
  logLevel: "error",
  // Banner: shims de CJS para libs externas que esperan require/__dirname.
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url); import { fileURLToPath as __f } from 'url'; import { dirname as __d } from 'path'; const __filename = __f(import.meta.url); const __dirname = __d(__filename);",
  },
});

console.log("[worker] bundled → worker/.dist/worker.mjs");
