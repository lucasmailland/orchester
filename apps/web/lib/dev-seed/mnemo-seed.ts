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
import { withMnemoTx } from "@orchester/mnemosyne";

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
}

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

  await withMnemoTx(opts.workspaceId, async (tx) => {
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

      await tx.execute(sql`
        INSERT INTO mnemo_fact (
          id, workspace_id, agent_id, scope, scope_ref, kind, subject,
          statement, confidence, pinned, relevance, hit_count,
          last_recalled_at, source_message_ids, linked_memory_ids,
          metadata, status, memory_type, attribution
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
          ${attribution}
        )
      `);

      if (pinned) pinnedCount++;
      byKind[kind] = (byKind[kind] ?? 0) + 1;
      byMemoryType[memoryType] = (byMemoryType[memoryType] ?? 0) + 1;
      inserted++;
    }
  });

  return { inserted, pinnedCount, byKind, byMemoryType };
}
