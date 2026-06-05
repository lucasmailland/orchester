/// <reference types="node" />
/**
 * Backfill brain_fact embeddings — direct DB writes, no HTTP.
 *
 * Picks up every NULL-embedding fact in the target workspace, calls OpenAI
 * text-embedding-3-small over `statement`, and writes the resulting
 * vector(1536) back to the row. With embeddings populated, `searchBrain`
 * (pgvector cosine) actually returns hits — semantic recall starts working.
 *
 * Cost: ~50 facts × ~50 tokens = ~2.5K tokens ≈ $0.00005 total.
 *
 * Usage:
 *
 *   DATABASE_URL=postgres://… \
 *   ENCRYPTION_SECRET=… \
 *   pnpm tsx apps/web/scripts/backfill-brain-embeddings.ts \
 *     --workspace-slug acme-inc
 */

import crypto from "node:crypto";
import { getDb, schema } from "@orchester/db";
import { eq, and, isNull } from "drizzle-orm";

interface Args {
  workspaceSlug: string;
}

function parseArgs(): Args {
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    const n = process.argv[i + 1];
    if (a === "--workspace-slug" && n) return { workspaceSlug: n };
    if (a === "--help" || a === "-h") {
      console.log("Usage: --workspace-slug <slug>");
      process.exit(0);
    }
  }
  console.error("Missing --workspace-slug.");
  process.exit(2);
}

// AES-256-GCM decrypt — mirrors apps/web/lib/encryption.ts. Inlined because
// importing lib/embeddings would pull "server-only" which throws here.
const VPR = /^v(\d+):/;
function deriveKey(secret: string): Buffer {
  if (secret.length !== 64) {
    throw new Error(`ENCRYPTION_SECRET must be 32-byte hex. Got ${secret.length}`);
  }
  return Buffer.from(secret, "hex");
}
let cachedKey: Buffer | null = null;
function decrypt(encoded: string): string {
  if (!cachedKey) {
    const s = process.env.ENCRYPTION_SECRET;
    if (!s) throw new Error("ENCRYPTION_SECRET required");
    cachedKey = deriveKey(s);
  }
  const m = VPR.exec(encoded);
  const body = m ? encoded.slice(m[0].length) : encoded;
  const [ivB64, tagB64, ctB64] = body.split(":");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Invalid ciphertext");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", cachedKey, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

async function callOpenAIEmbed(
  apiKey: string,
  model: string,
  texts: string[]
): Promise<{ vectors: number[][]; tokensUsed: number }> {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!r.ok) throw new Error(`OpenAI embeddings ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as {
    data: Array<{ embedding: number[] }>;
    usage?: { total_tokens?: number };
  };
  return {
    vectors: j.data.map((d) => d.embedding),
    tokensUsed: j.usage?.total_tokens ?? 0,
  };
}

async function main() {
  const { workspaceSlug } = parseArgs();
  const db = getDb();

  const wsRows = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.slug, workspaceSlug))
    .limit(1);
  const ws = wsRows[0];
  if (!ws) {
    console.error(`Workspace not found: slug=${workspaceSlug}`);
    process.exit(1);
  }
  console.log(`◆ Embedding brain facts for ${ws.name} (${ws.id})…`);

  const providerRows = await db
    .select()
    .from(schema.aiProviders)
    .where(
      and(eq(schema.aiProviders.workspaceId, ws.id), eq(schema.aiProviders.provider, "openai"))
    )
    .limit(1);
  const providerRow = providerRows[0];
  if (!providerRow || !providerRow.enabled) {
    console.error("No enabled OpenAI provider. Connect one in Settings → Providers.");
    process.exit(1);
  }
  const openaiKey = decrypt(providerRow.apiKey);

  const facts = await db
    .select({ id: schema.brainFacts.id, statement: schema.brainFacts.statement })
    .from(schema.brainFacts)
    .where(and(eq(schema.brainFacts.workspaceId, ws.id), isNull(schema.brainFacts.embedding)));

  if (facts.length === 0) {
    console.log("✓ All facts already have embeddings — nothing to do.");
    process.exit(0);
  }
  console.log(`◆ ${facts.length} facts pending embedding…`);

  // text-embedding-3-small accepts batch inputs — one call covers all ~50.
  const { vectors, tokensUsed } = await callOpenAIEmbed(
    openaiKey,
    "text-embedding-3-small",
    facts.map((f) => f.statement)
  );

  // Use drizzle's typed update — the `embedding` column is a customType
  // that serializes number[] → "[x,y,…]" on the way in (see brain.ts).
  let written = 0;
  for (let k = 0; k < facts.length; k++) {
    const id = facts[k]!.id;
    const vec = vectors[k]!;
    await db
      .update(schema.brainFacts)
      .set({ embedding: vec, updatedAt: new Date() })
      .where(eq(schema.brainFacts.id, id));
    written++;
    if (written % 10 === 0 || written === facts.length) {
      console.log(`✓ wrote ${written}/${facts.length}`);
    }
  }

  console.log("");
  console.log(`Done. embedded=${written}  tokens=${tokensUsed}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
