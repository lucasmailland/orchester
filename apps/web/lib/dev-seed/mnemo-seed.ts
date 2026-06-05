// apps/web/lib/dev-seed/mnemo-seed.ts
//
// v1.6 G1-6: dev-only seeding helper for the Memory Inspector smoke
// test. Inserts `count` synthetic mnemo_fact rows via direct SQL
// inside a `withMnemoTx` transaction so RLS sets `app.workspace_id`
// and the rows land in the right tenant.
//
// Distribution across the 30 default seed:
//   - 7 kinds: preference, trait, event, relationship, skill, concern, other
//   - 4 memory types: semantic, episodic, procedural, working
//   - 3 attributions: self, observed, inferred
//   - 5 pinned (mix of recently-recalled + low hit_count to exercise
//     pin-vs-auto-pin UX)
//   - 3 with high hit_count (to populate the "frequently recalled"
//     sort axis in the Inspector list)
//
// Mode A (no embeddings) — keeps the seeder host-DB-independent. FTS
// covers Inspector render via the `text_lemmatized` generated column,
// so the Inspector renders fine without a vector backfill.
import { sql } from "drizzle-orm";
import { withMnemoTx } from "@mnemosyne/core";

type FactKind = "preference" | "trait" | "event" | "relationship" | "skill" | "concern" | "other";
type MemoryType = "semantic" | "episodic" | "procedural" | "working";
// Matches the CHECK constraint added in migration 0035_mnemosyne_attribution.sql.
type Attribution = "user_stated" | "user_belief" | "objective_fact" | "inferred";

const KINDS: FactKind[] = [
  "preference",
  "trait",
  "event",
  "relationship",
  "skill",
  "concern",
  "other",
];
const MEMORY_TYPES: MemoryType[] = ["semantic", "episodic", "procedural", "working"];
const ATTRIBUTIONS: Attribution[] = ["user_stated", "user_belief", "objective_fact", "inferred"];

// Per-kind statement templates — enough variety that FTS hits each
// kind without dropping into single-token chaff.
const STATEMENTS: Record<FactKind, string[]> = {
  preference: [
    "user prefers espresso to filter coffee in the morning",
    "user enjoys hiking on weekends when the weather is dry",
    "user likes lo-fi soundtracks while pair-programming",
    "user dislikes phone calls before noon",
    "user is partial to crime novels over biographies",
  ],
  trait: [
    "user is methodical and reviews their own pull requests before merging",
    "user is empathic toward new hires struggling with onboarding",
    "user is direct in feedback but always softens with concrete examples",
    "user is curious about category theory and topology",
  ],
  event: [
    "user travelled to Tokyo for the JSConf keynote in March 2025",
    "user shipped the bitemporal recall layer in Q4 2024",
    "user gave a talk on agentic memory at LangChain Days",
    "user adopted a labrador retriever named Mochi last spring",
  ],
  relationship: [
    "user reports to the Director of Platform Engineering",
    "user collaborates closely with the data infra team on storage migrations",
    "user mentors a junior IC on system design quarterly",
  ],
  skill: [
    "user is fluent in TypeScript and writes idiomatic Drizzle queries",
    "user can debug pg_hba.conf authentication issues from memory",
    "user designed the original schema for the audit log chain",
  ],
  concern: [
    "user worries about embedding cost drift as the workspace scales",
    "user is concerned about RLS regressions hidden behind FORCE bypass",
    "user is uneasy about long-running migrations on production",
  ],
  other: [
    "user is reading the Mnemosyne design doc cover-to-cover this week",
    "user is evaluating an alternative vector store for cold storage",
  ],
};

function pick<T>(arr: readonly T[], i: number): T {
  return arr[i % arr.length]!;
}

// Lightweight cuid-shaped id generator — we don't need cuid2 for a
// dev-only seeder; a timestamp + counter is enough to keep ids
// unique across the run and obviously synthetic in DB inspection.
function makeId(i: number): string {
  return `mfact_seed_${Date.now().toString(36)}_${i.toString().padStart(3, "0")}`;
}

export interface SeedMnemoOptions {
  workspaceId: string;
  agentId?: string | null;
  /** Default 30. */
  count?: number;
}

export interface SeedMnemoResult {
  inserted: number;
  pinnedCount: number;
  byKind: Record<FactKind, number>;
  byMemoryType: Record<MemoryType, number>;
  entitiesInserted: number;
  relationsInserted: number;
}

// v2.0 — typed entities seeded alongside facts so the Memory Graph
// view has real nodes to render in dev. Each entity is keyed by a
// stable `slug` so we can hand-link `mnemo_fact.entity_id` and
// `mnemo_relation.source_id / target_id` deterministically across
// re-seeds.
type EntityKind = "person" | "organization" | "project" | "concept" | "place" | "other";
type SeedEntity = {
  slug: string;
  name: string;
  kind: EntityKind;
  aliases?: string[];
  description?: string;
};
const SEED_ENTITIES: SeedEntity[] = [
  {
    slug: "lucas",
    name: "Lucas",
    kind: "person",
    aliases: ["@lucas", "Lucas Mailland"],
    description: "Founder · primary user",
  },
  {
    slug: "daisy",
    name: "Daisy",
    kind: "person",
    aliases: ["@daisy"],
    description: "Sales rep, reports to Lucas",
  },
  {
    slug: "acme",
    name: "Acme Inc.",
    kind: "organization",
    aliases: ["Acme", "Acme Corp"],
    description: "Prospect / customer",
  },
  {
    slug: "project_x",
    name: "Project X",
    kind: "project",
    aliases: ["project_x"],
    description: "Launch target Q3 2026",
  },
  {
    slug: "mnemosyne",
    name: "Mnemosyne",
    kind: "concept",
    aliases: ["mnemo", "memory engine"],
    description: "The cognitive memory layer",
  },
  {
    slug: "buenos_aires",
    name: "Buenos Aires",
    kind: "place",
    aliases: ["BA"],
    description: "Lucas's city",
  },
];

// Map a fact subject/statement substring → entity slug. This is a
// dev-only heuristic so seeded facts get plausible `entity_id` links.
// In production this is what the entity-classifier LLM pass does
// (see vendor/mnemosyne/packages/core/src/entity/extract.ts).
function resolveEntitySlug(subject: string, statement: string): string | null {
  const blob = `${subject} ${statement}`.toLowerCase();
  if (blob.includes("@daisy") || blob.includes("daisy")) return "daisy";
  if (blob.includes("@lucas") || blob.includes("lucas")) return "lucas";
  if (blob.includes("acme")) return "acme";
  if (blob.includes("project_x") || blob.includes("project x")) return "project_x";
  if (blob.includes("mnemosyne") || blob.includes("mnemo")) return "mnemosyne";
  if (blob.includes("buenos aires") || blob.includes(" ba ")) return "buenos_aires";
  return null;
}

// Typed relations between the seeded entities. Each tuple becomes one
// `mnemo_relation` row so the graph UI has every legend item covered:
// related / conflicts_with / derived_from / supersedes / part_of / member_of.
type SeedRelation = {
  source: string;
  target: string;
  relation:
    | "related"
    | "conflicts_with"
    | "derived_from"
    | "supersedes"
    | "part_of"
    | "member_of"
    | "compatible";
  confidence: number;
  provenance: string;
};
const SEED_RELATIONS: SeedRelation[] = [
  { source: "lucas", target: "acme", relation: "related", confidence: 0.95, provenance: "seed" },
  { source: "daisy", target: "acme", relation: "member_of", confidence: 0.98, provenance: "seed" },
  {
    source: "daisy",
    target: "lucas",
    relation: "related",
    confidence: 0.9,
    provenance: "seed: reports-to",
  },
  {
    source: "project_x",
    target: "acme",
    relation: "part_of",
    confidence: 0.92,
    provenance: "seed",
  },
  {
    source: "lucas",
    target: "buenos_aires",
    relation: "related",
    confidence: 0.99,
    provenance: "seed: lives-in",
  },
  {
    source: "mnemosyne",
    target: "project_x",
    relation: "related",
    confidence: 0.7,
    provenance: "seed",
  },
  {
    source: "lucas",
    target: "mnemosyne",
    relation: "related",
    confidence: 0.85,
    provenance: "seed: author",
  },
  // A typed conflict so the red dashed edge surfaces in the legend.
  {
    source: "acme",
    target: "project_x",
    relation: "conflicts_with",
    confidence: 0.6,
    provenance: "seed: scoping debate",
  },
];

/**
 * Insert `count` synthetic mnemo_fact rows for a workspace. Returns
 * a summary suitable for sending back from the dev-only admin
 * endpoint (smoke test asserts on the counts).
 */
export async function seedMnemoFacts(opts: SeedMnemoOptions): Promise<SeedMnemoResult> {
  const count = Math.min(Math.max(opts.count ?? 30, 1), 200);
  const byKind: Record<FactKind, number> = {
    preference: 0,
    trait: 0,
    event: 0,
    relationship: 0,
    skill: 0,
    concern: 0,
    other: 0,
  };
  const byMemoryType: Record<MemoryType, number> = {
    semantic: 0,
    episodic: 0,
    procedural: 0,
    working: 0,
  };
  let pinnedCount = 0;
  let inserted = 0;
  let entitiesInserted = 0;
  let relationsInserted = 0;

  await withMnemoTx(opts.workspaceId, async (tx) => {
    // v2 — every fact needs an episode_id (migration 0051 NOT NULL).
    // Seed inserts a single placeholder synthetic episode and reuses
    // it for all rows — keeps the seed dataset coherent.
    const seedEpisodeId = `mepi_seed_${opts.workspaceId}`;
    await tx.execute(sql`
      INSERT INTO mnemo_episode (id, workspace_id, title, narrative, occurred_at, is_synthetic)
      VALUES (${seedEpisodeId}, ${opts.workspaceId}, 'dev-seed', '', now(), true)
      ON CONFLICT (id) DO NOTHING
    `);

    // v2.0 — typed entities. Insert idempotently keyed on the
    // (workspace_id, name, kind) unique constraint so re-seeding
    // doesn't duplicate rows. The deterministic id lets us link
    // `mnemo_fact.entity_id` and `mnemo_relation.source_id/target_id`
    // without a second query.
    const entityIdBySlug = new Map<string, string>();
    for (const ent of SEED_ENTITIES) {
      // Short hash of the workspace id to keep the entity id within
      // typical id-column length budgets without truncating the slug.
      const wsHash = opts.workspaceId.slice(0, 8);
      const entId = `ment_seed_${wsHash}_${ent.slug}`;
      entityIdBySlug.set(ent.slug, entId);
      // Postgres text[] literal — Drizzle's `sql` tag treats JS arrays
      // as separate params, so we serialise to the PG array form
      // manually. Names without commas / braces / quotes are safe
      // unquoted (all the seed aliases are).
      const aliasesLit = `{${(ent.aliases ?? []).map((a) => `"${a.replace(/"/g, '\\"')}"`).join(",")}}`;
      await tx.execute(sql`
        INSERT INTO mnemo_entity (id, workspace_id, name, kind, aliases, description, mention_count, metadata)
        VALUES (
          ${entId}, ${opts.workspaceId}, ${ent.name}, ${ent.kind},
          ${aliasesLit}::text[], ${ent.description ?? null}, 1,
          ${JSON.stringify({ seed: true })}::jsonb
        )
        ON CONFLICT (workspace_id, name, kind) DO UPDATE SET
          last_seen_at = now(),
          mention_count = mnemo_entity.mention_count + 1
      `);
      entitiesInserted++;
    }

    // v2.0 — typed relations between the seeded entities. Idempotent
    // via a deterministic id so re-seeds don't duplicate the graph.
    for (const rel of SEED_RELATIONS) {
      const sId = entityIdBySlug.get(rel.source);
      const tId = entityIdBySlug.get(rel.target);
      if (!sId || !tId) continue;
      const wsHash = opts.workspaceId.slice(0, 8);
      const relId = `mrel_seed_${wsHash}_${rel.source}_${rel.relation}_${rel.target}`;
      await tx.execute(sql`
        INSERT INTO mnemo_relation (
          id, workspace_id, source_kind, source_id, target_kind, target_id,
          relation, confidence, provenance, marked_by_kind, judgment_status
        )
        VALUES (
          ${relId}, ${opts.workspaceId}, 'entity', ${sId}, 'entity', ${tId},
          ${rel.relation}, ${rel.confidence}, ${rel.provenance}, 'system', 'judged'
        )
        ON CONFLICT (id) DO NOTHING
      `);
      relationsInserted++;
    }
    for (let i = 0; i < count; i++) {
      const kind = pick(KINDS, i);
      const memoryType = pick(MEMORY_TYPES, i + 2);
      const attribution = pick(ATTRIBUTIONS, i + 5);
      const statements = STATEMENTS[kind];
      // Append `[seed #i]` to the canonical template so the dedup
      // unique constraint (workspace_id, scope, scope_ref, subject,
      // md5(statement)) doesn't fire on the templates repeating
      // across the 30-row seed.
      const statement = `${statements[i % statements.length]!} [seed #${i}]`;
      const pinned = i < 5;
      const hitCount = i < 3 ? 25 + i * 5 : 0;
      const confidence = 0.6 + (i % 4) * 0.1;
      const subject = i % 3 === 0 ? "user" : i % 3 === 1 ? "team" : "system";
      const factId = makeId(i);
      // v2.0 — link each fact to one of the seeded entities so the
      // Memory Graph view has dense clusters in dev. First try a
      // heuristic match on the statement (mirrors what the entity
      // classifier does on real extracts). If no match, rotate
      // through entities deterministically so ~every fact gets a
      // link — this keeps the dev graph visually meaningful without
      // affecting the real extractor's behaviour in prod.
      const SEED_SLUGS = SEED_ENTITIES.map((e) => e.slug);
      const linkedEntityId =
        entityIdBySlug.get(resolveEntitySlug(subject, statement) ?? "") ??
        entityIdBySlug.get(SEED_SLUGS[i % SEED_SLUGS.length] ?? "") ??
        null;

      await tx.execute(sql`
        INSERT INTO mnemo_fact (
          id, workspace_id, agent_id, scope, scope_ref, kind, subject,
          statement, confidence, pinned, relevance, hit_count,
          last_recalled_at, source_message_ids, linked_memory_ids,
          metadata, status, memory_type, attribution, episode_id, entity_id
        )
        VALUES (
          ${factId},
          ${opts.workspaceId},
          ${opts.agentId ?? null},
          'global',
          NULL,
          ${kind},
          ${subject},
          ${statement},
          ${confidence},
          ${pinned},
          1.0,
          ${hitCount},
          ${hitCount > 0 ? sql`now() - (random() * interval '7 days')` : sql`NULL`},
          ARRAY[]::text[],
          ARRAY[]::text[],
          ${JSON.stringify({ seed: true, batch: i })}::jsonb,
          'active',
          ${memoryType},
          ${attribution},
          ${seedEpisodeId},
          ${linkedEntityId}
        )
      `);

      if (pinned) pinnedCount++;
      byKind[kind] = (byKind[kind] ?? 0) + 1;
      byMemoryType[memoryType] = (byMemoryType[memoryType] ?? 0) + 1;
      inserted++;
    }
  });

  return { inserted, pinnedCount, byKind, byMemoryType, entitiesInserted, relationsInserted };
}
