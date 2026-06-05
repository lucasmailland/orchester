// packages/mnemosyne/tsup.config.ts
//
// Build configuration for the npm-publishable @orchester/mnemosyne
// package.
//
// What this produces
// ------------------
//   dist/
//     index.mjs          — ESM entry (modern Node, bundlers)
//     index.js           — CJS entry (legacy CommonJS consumers)
//     index.d.ts         — type declarations (ESM resolution)
//     index.d.cts        — type declarations (CJS resolution)
//     protocol.mjs       — secondary subpath entry for the frozen
//                          Memory Protocol artifact (consumers that
//                          only want the system-prompt string don't
//                          need to pull the full package in)
//     protocol.js
//     protocol.d.ts
//     protocol.d.cts
//     migrate.mjs        — CLI for the bundled migrations (bin)
//
// Why dual ESM + CJS
// ------------------
// The package targets two real audiences:
//   1. Modern TS products using ESM (Next.js, Bun, ts-node ESM mode,
//      Vite-bundled servers)
//   2. Legacy Node services still on CommonJS (a handful of long-lived
//      enterprise customers)
//
// Shipping both keeps Mnemosyne a "just install it" package for both
// camps. tsup handles the dual emit; we only have to opt in.
//
// Why externalising peer deps
// ---------------------------
// `drizzle-orm`, `postgres`, `zod`, etc. live as peer deps in
// package.json so consumers can pin their own versions and avoid
// duplicate bundles. tsup respects the `external` list AND auto-
// externalises everything that resolves outside `src/` by default,
// but we list peers explicitly for clarity in failure messages.

import { defineConfig } from "tsup";

export default defineConfig({
  // Multiple entry points for the package's exports map (see
  // package.json). Each one becomes its own bundle so consumers can
  // tree-shake per-subpath instead of pulling the full package.
  entry: {
    index: "src/index.ts",
    protocol: "src/protocol/v1.ts",
    migrate: "src/cli/migrate.ts",
  },

  format: ["esm", "cjs"],

  // .d.ts emission is intentionally OFF in v1.6.0.
  //
  // Mnemosyne's source imports `@orchester/db` for the Drizzle schema
  // tables — a workspace package that doesn't itself publish to npm
  // yet. tsup's DTS bundler tries to follow the import and resolve
  // types from `packages/db/src/...`, which works locally but doesn't
  // round-trip to a tarball: a consumer installing
  // `@orchester/mnemosyne` from npm wouldn't have the matching
  // `@orchester/db` source to satisfy the type references.
  //
  // For v1.6.0 the JS bundles ship and the runtime works fine; the
  // public API is documented in README.md and consumers can import
  // types from the runtime via their own `declare module` if they
  // need TypeScript inference.
  //
  // Tracked for v1.6.1: either (a) publish @orchester/db to npm
  // alongside mnemosyne, or (b) re-export the relevant schema /
  // type shapes into mnemosyne's own surface so the DTS emission is
  // self-contained.
  dts: false,
  tsconfig: "./tsconfig.build.json",

  // Keep `dist/` clean across builds — no stale files from a previous
  // refactor sneaking into a tarball.
  clean: true,

  // Source maps inline so downstream stack traces point at the real
  // source files even after the consumer's bundler runs.
  sourcemap: true,

  // Don't minify a library: it hurts debuggability for the
  // consumer's developer with zero runtime win.
  minify: false,

  // Target a modern-but-conservative runtime. Node 20 is the current
  // LTS floor; everything older has been EOL'd. Modern enough to
  // emit native `?.` / `??` / class fields without polyfill noise.
  target: "node20",

  // Externalise every peer dep so the consumer's lockfile owns the
  // version. tsup also auto-externalises bare imports it can't
  // resolve, but listing peers makes the failure mode obvious
  // ("missing peer X") instead of "couldn't bundle drizzle-orm".
  external: [
    "drizzle-orm",
    "postgres",
    "@paralleldrive/cuid2",
    "zod",
    "lru-cache",
    "@orchester/db",
  ],

  // splitting OFF — tree-shaking still works because we ESM-export
  // by name; off means each `entry` produces ONE file, which is
  // friendlier for CDN-based consumers.
  splitting: false,

  // Banner: a tiny "this is the bundled @orchester/mnemosyne" line
  // at the top of each emitted file so error reports include the
  // version of the package the user is running.
  banner: {
    js: "/* @orchester/mnemosyne — see https://github.com/lucasmailland/orchester */",
  },

  // After tsup writes the JS bundles, mark the CLI bin executable
  // so `npx mnemo-migrate` works straight from a consumer's
  // installed node_modules without a separate `chmod`. The shebang
  // is in the source file (`#!/usr/bin/env node`) so the file
  // itself is well-formed; the `+x` bit is what npx looks at.
  onSuccess: "chmod +x dist/migrate.js dist/migrate.cjs 2>/dev/null || true",
});
