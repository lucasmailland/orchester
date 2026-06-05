/**
 * v1.6 G1-5: i18n key-coverage check.
 *
 * For every TS/TSX file under apps/web/{app,components,lib}/, picks
 * up `useTranslations("ns")` declarations + `t("key")` calls and
 * asserts the resulting dotted keys exist in en.json, es.json AND
 * pt.json.
 *
 * Heuristic (conservative): we trace each `const t = useTranslations("ns")`
 * (and `const tFoo = useTranslations("ns")`) to its identifier, then
 * scan for `<identifier>(...)` calls. The identifier scope is the
 * whole file — close enough for the way next-intl is used in this
 * codebase (one `t` per component, no shadowing).
 *
 * Dynamic / template literal keys (e.g. t(`x.${y}`)) are skipped.
 *
 * Exit codes:
 *   0 - every detected (locale, dotted-key) pair resolves.
 *   1 - missing keys printed on stderr.
 *
 * Run:
 *   pnpm --filter @orchester/web i18n:check
 */
/* eslint-disable no-console */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

const WEB_ROOT = resolve(__dirname, "..");
const MESSAGES_DIR = resolve(WEB_ROOT, "messages");
const SCAN_DIRS = ["app", "components", "lib"].map((d) => resolve(WEB_ROOT, d));

const LOCALES = ["en", "es", "pt"] as const;
type Locale = (typeof LOCALES)[number];

type LocaleBag = Record<string, unknown>;

function readLocale(loc: Locale): LocaleBag {
  const raw = readFileSync(join(MESSAGES_DIR, `${loc}.json`), "utf8");
  return JSON.parse(raw) as LocaleBag;
}

function hasKey(bag: LocaleBag, dotted: string): boolean {
  const parts = dotted.split(".");
  let cur: unknown = bag;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return false;
    cur = (cur as Record<string, unknown>)[p];
    if (cur === undefined) return false;
  }
  return true;
}

function* walk(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      if (e === "node_modules" || e === ".next" || e === "dist") continue;
      yield* walk(full);
    } else if (s.isFile() && /\.(ts|tsx|mjs)$/.test(e)) {
      yield full;
    }
  }
}

// `const t = useTranslations("ns")` OR `const tSens = useTranslations("ns")`
// — captures both the LHS identifier and the namespace string.
const DECL_RE = /\bconst\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*useTranslations\(["']([^"'`]+)["']\)/g;

interface Use {
  file: string;
  key: string;
}

function collectUses(): Use[] {
  // For each file we collect a list of (id, ns) pairs in source order
  // plus every `id("key")` call. The "permissive" resolution rule: a
  // key is OK if it exists under ANY of that id's bound namespaces in
  // the file. Without a real parser we can't pin down which
  // useTranslations() call lexically encloses a given `t(...)` call,
  // and false-positives are noisier than false-negatives for this
  // tool.
  const uses: Use[] = [];
  for (const dir of SCAN_DIRS) {
    for (const f of walk(dir)) {
      const src = readFileSync(f, "utf8");
      DECL_RE.lastIndex = 0;
      const idToNamespaces = new Map<string, Set<string>>();
      let m: RegExpExecArray | null;
      while ((m = DECL_RE.exec(src)) !== null) {
        const id = m[1]!;
        const ns = m[2]!;
        if (!idToNamespaces.has(id)) idToNamespaces.set(id, new Set());
        idToNamespaces.get(id)!.add(ns);
      }
      if (idToNamespaces.size === 0) continue;

      for (const [id, namespaces] of idToNamespaces) {
        const callRe = new RegExp(
          String.raw`(?<![A-Za-z0-9_$])` +
            escapeRegExp(id) +
            String.raw`\(\s*["']([a-zA-Z][a-zA-Z0-9_.]*?)["']`,
          "g"
        );
        let mm: RegExpExecArray | null;
        while ((mm = callRe.exec(src)) !== null) {
          // Each key is a "permissive" match: ANY of the bound
          // namespaces resolving to it is good enough. Emit one
          // alternative per namespace; the validator marks the key
          // as missing only if ALL alternatives are missing.
          const alts = Array.from(namespaces).map((ns) => `${ns}.${mm![1]!}`);
          uses.push({ file: f, key: alts.join("||") });
        }
      }
    }
  }
  return uses;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function main(): void {
  const bags = Object.fromEntries(LOCALES.map((l) => [l, readLocale(l)])) as Record<
    Locale,
    LocaleBag
  >;
  const uses = collectUses();
  const allKeys = Array.from(new Set(uses.map((u) => u.key))).sort();
  const missingByLocale = new Map<Locale, string[]>();
  for (const loc of LOCALES) missingByLocale.set(loc, []);

  for (const key of allKeys) {
    const alts = key.split("||");
    for (const loc of LOCALES) {
      // Permissive: pass if ANY alternative resolves.
      const ok = alts.some((a) => hasKey(bags[loc], a));
      if (!ok) missingByLocale.get(loc)!.push(alts.length === 1 ? key : `(${alts.join(" | ")})`);
    }
  }

  let totalMissing = 0;
  for (const loc of LOCALES) {
    const missing = missingByLocale.get(loc)!;
    if (missing.length === 0) continue;
    console.error(`\n[i18n] ${loc}.json missing ${missing.length} keys:`);
    for (const k of missing) console.error(`  - ${k}`);
    totalMissing += missing.length;
  }

  if (totalMissing === 0) {
    console.log(`[i18n] OK - ${allKeys.length} keys, all present in en/es/pt.`);
    process.exit(0);
  }
  console.error(`\n[i18n] FAIL - ${totalMissing} missing key references across locales.`);
  process.exit(1);
}

main();
