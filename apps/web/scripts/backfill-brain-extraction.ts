/// <reference types="node" />
/**
 * Backfill brain extractions — streamlined OpenAI extraction over seeded
 * conversations. Persists facts + a brain_extraction_job per conversation
 * so the Studio shows real extraction history.
 *
 * Why not invoke the real runBrainExtractJob? It depends on pg-boss +
 * Mnemosyne + cross-tenant tx wrappers that import "server-only" and
 * cannot run from a plain Node script. We replicate just the surface the
 * Studio reads: brain_fact rows + brain_extraction_job rows.
 *
 * Facts produced are tagged metadata.source='demo_extraction'.
 *
 * Cost: ~8 chat completions (gpt-4o-mini) + 1 embedding batch <= $0.01.
 *
 * Usage:
 *   DATABASE_URL=... ENCRYPTION_SECRET=... \
 *   pnpm tsx apps/web/scripts/backfill-brain-extraction.ts \
 *     --workspace-slug acme-inc
 */

import crypto from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import { getDb, schema } from "@orchester/db";
import { eq, and, asc } from "drizzle-orm";

interface Args {
  workspaceSlug: string;
  maxConversations: number;
}

function parseArgs(): Args {
  let max = 8;
  let slug: string | undefined;
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    const n = process.argv[i + 1];
    if (a === "--workspace-slug" && n) {
      slug = n;
      i++;
    } else if (a === "--max" && n) {
      max = parseInt(n, 10);
      i++;
    } else if (a === "--help" || a === "-h") {
      console.log("Usage: --workspace-slug <slug> [--max 8]");
      process.exit(0);
    }
  }
  if (!slug) {
    console.error("Missing --workspace-slug.");
    process.exit(2);
  }
  return { workspaceSlug: slug, maxConversations: max };
}

// AES-256-GCM decrypt — mirrors apps/web/lib/encryption.ts.
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

async function callOpenAIChat(apiKey: string, prompt: string) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });
  if (!r.ok) throw new Error(`OpenAI chat ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { total_tokens?: number };
  };
  return { content: j.choices[0]?.message.content ?? "{}", tokensUsed: j.usage?.total_tokens ?? 0 };
}

async function callOpenAIEmbed(apiKey: string, texts: string[]) {
  if (texts.length === 0) return { vectors: [] as number[][], tokensUsed: 0 };
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts }),
  });
  if (!r.ok) throw new Error(`OpenAI embeddings ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as {
    data: Array<{ embedding: number[] }>;
    usage?: { total_tokens?: number };
  };
  return { vectors: j.data.map((d) => d.embedding), tokensUsed: j.usage?.total_tokens ?? 0 };
}

interface ExtractedFact {
  kind: "preference" | "trait" | "event" | "relationship" | "skill" | "concern" | "other";
  subject: string;
  statement: string;
  confidence: number;
}

const ALLOWED_KINDS: ExtractedFact["kind"][] = [
  "preference",
  "trait",
  "event",
  "relationship",
  "skill",
  "concern",
  "other",
];

const EXTRACTION_PROMPT = `You extract durable facts from a customer support / coaching conversation.

Rules:
- A "fact" is information likely to matter again later (preferences, attributes, decisions, commitments).
- DO NOT extract greetings, small talk, or one-off questions.
- Output 0 to 3 facts, no more.
- Each fact: { kind, subject (1-3 words), statement (1 sentence, 10-300 chars), confidence (0-1) }.
- kind must be exactly one of: preference, trait, event, relationship, skill, concern, other.
- Be concrete and grounded in the conversation.

Return JSON: { "facts": [...] }. If nothing durable was said, return { "facts": [] }.

Conversation:
`;

async function main() {
  const { workspaceSlug, maxConversations } = parseArgs();
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
  console.log(`◆ Brain extraction over ${ws.name} (${ws.id})…`);

  const providerRows = await db
    .select()
    .from(schema.aiProviders)
    .where(
      and(eq(schema.aiProviders.workspaceId, ws.id), eq(schema.aiProviders.provider, "openai"))
    )
    .limit(1);
  const providerRow = providerRows[0];
  if (!providerRow || !providerRow.enabled) {
    console.error("No enabled OpenAI provider.");
    process.exit(1);
  }
  const openaiKey = decrypt(providerRow.apiKey);

  const candidates = await db
    .select({
      id: schema.conversations.id,
      agentId: schema.conversations.agentId,
      messageCount: schema.conversations.messageCount,
    })
    .from(schema.conversations)
    .where(
      and(eq(schema.conversations.workspaceId, ws.id), eq(schema.conversations.status, "closed"))
    )
    .limit(maxConversations);

  const targets = candidates.filter((c) => c.agentId && (c.messageCount ?? 0) >= 2);
  if (targets.length === 0) {
    console.log("✗ No eligible conversations.");
    process.exit(0);
  }
  console.log(`◆ Running extraction on ${targets.length} conversations…`);

  let totalFacts = 0;
  let totalChatTokens = 0;
  let totalEmbedTokens = 0;
  const collectedFacts: Array<{
    statement: string;
    kind: ExtractedFact["kind"];
    subject: string;
    confidence: number;
    conversationId: string;
    agentId: string;
  }> = [];

  for (const conv of targets) {
    const msgs = await db
      .select({ role: schema.messages.role, content: schema.messages.content })
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conv.id))
      .orderBy(asc(schema.messages.createdAt));

    const transcript = msgs.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n");

    const jobId = createId();
    const jobStarted = new Date();
    await db.insert(schema.brainExtractionJobs).values({
      id: jobId,
      workspaceId: ws.id,
      conversationId: conv.id,
      state: "running",
      messageCount: msgs.length,
      startedAt: jobStarted,
    });

    try {
      const { content, tokensUsed } = await callOpenAIChat(
        openaiKey,
        EXTRACTION_PROMPT + transcript
      );
      totalChatTokens += tokensUsed;

      let extracted: ExtractedFact[] = [];
      try {
        const parsed = JSON.parse(content) as { facts?: ExtractedFact[] };
        extracted = Array.isArray(parsed.facts) ? parsed.facts : [];
      } catch {
        extracted = [];
      }

      const valid = extracted.filter(
        (f) =>
          f &&
          typeof f.statement === "string" &&
          f.statement.length >= 10 &&
          ALLOWED_KINDS.includes(f.kind)
      );

      for (const f of valid) {
        collectedFacts.push({
          statement: f.statement.slice(0, 400),
          kind: f.kind,
          subject: (f.subject ?? "general").slice(0, 80),
          confidence: Math.min(1, Math.max(0, Number(f.confidence) || 0.7)),
          conversationId: conv.id,
          agentId: conv.agentId!,
        });
      }

      await db
        .update(schema.brainExtractionJobs)
        .set({ state: "done", factsProduced: valid.length, completedAt: new Date() })
        .where(eq(schema.brainExtractionJobs.id, jobId));

      totalFacts += valid.length;
      console.log(`✓ ${conv.id.slice(0, 12)}… — ${valid.length} facts`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`✗ ${conv.id.slice(0, 12)}… — ${msg}`);
      await db
        .update(schema.brainExtractionJobs)
        .set({ state: "failed", error: msg.slice(0, 500), completedAt: new Date() })
        .where(eq(schema.brainExtractionJobs.id, jobId));
    }
  }

  if (collectedFacts.length > 0) {
    const { vectors, tokensUsed } = await callOpenAIEmbed(
      openaiKey,
      collectedFacts.map((f) => f.statement)
    );
    totalEmbedTokens += tokensUsed;

    for (let i = 0; i < collectedFacts.length; i++) {
      const f = collectedFacts[i]!;
      await db.insert(schema.brainFacts).values({
        id: createId(),
        workspaceId: ws.id,
        agentId: f.agentId,
        scope: "conversation",
        scopeRef: f.conversationId,
        kind: f.kind,
        subject: f.subject,
        statement: f.statement,
        confidence: f.confidence,
        pinned: false,
        relevance: 1.0,
        hitCount: 0,
        sourceMessageIds: [],
        status: "active",
        embedding: vectors[i]!,
        metadata: { source: "demo_extraction", model: "gpt-4o-mini" },
      });
    }
  }

  console.log("");
  console.log(
    `Done. jobs=${targets.length}  new_facts=${totalFacts}  chat_tokens=${totalChatTokens}  embed_tokens=${totalEmbedTokens}`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
