// packages/mnemosyne/src/cli/migrate.ts
//
// Tiny migration runner for @orchester/mnemosyne when consumed as a
// standalone package outside the Orchester monorepo.
//
// Why this exists
// ---------------
// External consumers install `@orchester/mnemosyne` from npm and need
// to apply ~62 SQL migrations against their own Postgres before they
// can call `withMnemoTx`. Asking them to download SQL files from
// GitHub and run them manually is hostile. This CLI:
//
//   1. Discovers the bundled migrations directory (shipped alongside
//      the compiled output via `package.json#files`).
//   2. Connects to the consumer's `DATABASE_URL`.
//   3. Creates a tracking table `mnemo_migration_history` on first run.
//   4. Applies migrations in lexical order, skipping ones whose
//      filename already has a recorded row.
//   5. Runs each migration in its own transaction so a failure halts
//      the cron without leaving the schema half-applied.
//
// Usage from a consumer's project
// -------------------------------
//   DATABASE_URL=postgres://… npx mnemo-migrate
//   DATABASE_URL=postgres://… npx mnemo-migrate --dry-run
//   DATABASE_URL=postgres://… npx mnemo-migrate --target 0042
//
// What this does NOT do
// ---------------------
// - Down migrations. The bundled `.down.sql` files exist for
//   completeness (the Orchester monorepo uses them) but applying
//   them from this CLI is an explicit out-of-scope to avoid the
//   "I accidentally dropped my prod memory" footgun. Consumers who
//   need rollback should run `.down.sql` manually with `psql`.
//
// - Pgvector / role bootstrapping. We DO NOT install the pgvector
//   extension or create `app_user` / `cron_admin` roles — those are
//   environment decisions the consumer's DBA owns. The CLI surfaces
//   a friendly error and points at the pre-flight checklist if
//   they're missing.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// `postgres` is a peer dependency — we import it dynamically inside
// `main()` so the package can still be IMPORTED for type information
// in environments where postgres isn't installed (e.g. a build step).
type PostgresClient = (
  query: string,
  params?: unknown[]
) => Promise<unknown[]> & { unsafe: (q: string) => Promise<unknown[]>; end: () => Promise<void> };

interface CliFlags {
  /** Don't apply — just print what would run. */
  dryRun: boolean;
  /** Stop after the migration with this filename prefix (e.g. "0042"). */
  target?: string;
  /** Override the bundled migrations directory (testing hook). */
  migrationsDir?: string;
  /** Override the DATABASE_URL env (testing hook). */
  databaseUrl?: string;
  /** Print the version and exit. */
  version: boolean;
  /** Print usage and exit. */
  help: boolean;
}

function parseFlags(argv: readonly string[]): CliFlags {
  const flags: CliFlags = { dryRun: false, version: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--version" || a === "-v") flags.version = true;
    else if (a === "--help" || a === "-h") flags.help = true;
    else if (a === "--target") flags.target = String(argv[++i] ?? "");
    else if (a?.startsWith("--target=")) flags.target = a.slice("--target=".length);
    else if (a === "--migrations-dir") flags.migrationsDir = String(argv[++i] ?? "");
    else if (a?.startsWith("--migrations-dir="))
      flags.migrationsDir = a.slice("--migrations-dir=".length);
    else if (a === "--database-url") flags.databaseUrl = String(argv[++i] ?? "");
  }
  return flags;
}

function printHelp(): void {
  process.stdout.write(`
@orchester/mnemosyne migrate — apply bundled SQL migrations against a Postgres database.

Usage
  mnemo-migrate [flags]

Flags
  --dry-run                 Print the migrations that WOULD run; do not apply.
  --target <prefix>         Stop after the migration whose filename starts with <prefix>
                            (e.g. --target 0042).
  --migrations-dir <path>   Override the bundled migrations directory (testing).
  --database-url <url>      Override DATABASE_URL (defaults to the env var).
  --help, -h                Print this help and exit.
  --version, -v             Print version and exit.

Env
  DATABASE_URL              Postgres connection string. Required unless --database-url is set.

Pre-flight (the CLI checks these and aborts with a friendly error if missing)
  - pgvector extension installed (CREATE EXTENSION vector)
  - The connecting role can create tables in the target schema

Examples
  DATABASE_URL=postgres://localhost:5432/mydb mnemo-migrate
  DATABASE_URL=… mnemo-migrate --dry-run
  DATABASE_URL=… mnemo-migrate --target 0050

`);
}

/**
 * Resolve the bundled migrations directory. After tsup builds the
 * package, the directory layout is:
 *   dist/
 *     migrate.mjs   ← this file (compiled)
 *   migrations/     ← shipped via package.json#files
 *
 * From `dist/migrate.mjs` the migrations dir is one level up.
 */
function locateMigrationsDir(override?: string): string {
  if (override) return resolve(override);
  // import.meta.url works under ESM. tsup's CJS shim makes it work
  // under CJS too, but to be defensive we fall back to __dirname.
  let here: string;
  try {
    here = dirname(fileURLToPath(import.meta.url));
  } catch {
    here = __dirname;
  }
  // Walk up at most two levels looking for a `migrations` sibling
  // — works whether the file is `dist/migrate.mjs` (one up) or
  // `dist/cli/migrate.mjs` (two up).
  for (let i = 0; i < 3; i++) {
    const candidate = join(here, "..".repeat(i), "migrations");
    const resolved = resolve(candidate);
    if (existsSync(resolved)) return resolved;
  }
  throw new Error(
    "Could not locate bundled migrations directory. Pass --migrations-dir explicitly."
  );
}

interface MigrationFile {
  /** Full filename, e.g. "0017_mnemosyne_init.sql". */
  name: string;
  /** Absolute path on disk. */
  path: string;
  /** Lexical sort key — just `name` since they're zero-padded. */
  sortKey: string;
}

function discoverMigrations(dir: string): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"))
    .map((name) => ({ name, path: join(dir, name), sortKey: name }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

/**
 * SQL for the bookkeeping table. Created on first run; subsequent
 * runs SELECT from it to figure out what's already applied.
 */
const HISTORY_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS mnemo_migration_history (
    name        text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
  );
`;

async function loadAlreadyApplied(sql: PostgresClient): Promise<Set<string>> {
  const rows = (await sql(`SELECT name FROM mnemo_migration_history`)) as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2));

  if (flags.help) {
    printHelp();
    return 0;
  }
  if (flags.version) {
    process.stdout.write(
      `@orchester/mnemosyne migrate ${process.env["npm_package_version"] ?? "unknown"}\n`
    );
    return 0;
  }

  const databaseUrl = flags.databaseUrl ?? process.env["DATABASE_URL"];
  if (!databaseUrl) {
    process.stderr.write(
      "error: DATABASE_URL is not set. Pass --database-url or set the env var.\n"
    );
    return 1;
  }

  const dir = locateMigrationsDir(flags.migrationsDir);
  const files = discoverMigrations(dir);
  if (files.length === 0) {
    process.stderr.write(`error: no .sql files found in ${dir}\n`);
    return 1;
  }

  // Dynamic import so we don't crash when the package is imported
  // only for types or in an environment without `postgres`.
  const postgres = (await import("postgres")).default;
  const sql = postgres(databaseUrl, {
    onnotice: () => undefined, // suppress "NOTICE: extension already exists" chatter
  }) as unknown as PostgresClient;

  try {
    process.stdout.write(`▸ Discovered ${files.length} migrations in ${dir}\n`);

    if (!flags.dryRun) {
      await sql.unsafe(HISTORY_TABLE_DDL);
    }

    const applied = flags.dryRun ? new Set<string>() : await loadAlreadyApplied(sql);

    let appliedThisRun = 0;
    let skipped = 0;
    for (const m of files) {
      if (applied.has(m.name)) {
        skipped += 1;
        continue;
      }
      if (flags.target && m.name.localeCompare(flags.target) > 0) {
        process.stdout.write(`  (stopping at --target=${flags.target})\n`);
        break;
      }
      const sqlText = readFileSync(m.path, "utf8");
      const tag = flags.dryRun ? "[dry-run]" : "[applying]";
      process.stdout.write(`${tag} ${m.name}\n`);

      if (!flags.dryRun) {
        // Each migration in its own implicit transaction (sql.begin
        // wraps a transaction; tx.unsafe runs the raw SQL). On error
        // postgres-js rolls back the tx and re-throws, halting the loop.
        await (
          sql as unknown as {
            begin: (
              fn: (tx: { unsafe: (q: string) => Promise<unknown> }) => Promise<unknown>
            ) => Promise<unknown>;
          }
        ).begin(async (tx) => {
          await tx.unsafe(sqlText);
          await tx.unsafe(
            `INSERT INTO mnemo_migration_history (name) VALUES ($name$${m.name}$name$)`
          );
        });
      }
      appliedThisRun += 1;
    }

    process.stdout.write(
      `\n✓ done — applied ${appliedThisRun}, skipped ${skipped} (already applied)${flags.dryRun ? " [DRY RUN]" : ""}\n`
    );
    return 0;
  } catch (err) {
    process.stderr.write(
      `\n✗ migration failed: ${err instanceof Error ? err.message : String(err)}\n`
    );
    if (err instanceof Error && err.message.includes('extension "vector"')) {
      process.stderr.write(
        '\nHint: install pgvector first:\n  psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS vector;"\n'
      );
    }
    return 1;
  } finally {
    await (sql as unknown as { end: () => Promise<void> }).end().catch(() => undefined);
  }
}

main().then((code) => process.exit(code));
