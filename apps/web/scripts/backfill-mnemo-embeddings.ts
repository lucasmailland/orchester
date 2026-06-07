/**
 * One-shot — backfill embeddings on Mnemosyne facts.
 *
 * Mnemosyne is stateless of LLM credentials. The host (Orchester)
 * holds the OpenAI key in `ai_provider`. Facts created before the
 * per-workspace embedding pipeline shipped were persisted with
 * `embedding = NULL`. The Brain Inspector reports "Embedded 0%" and
 * recall returns nothing relevant until those vectors land.
 *
 * What it does
 *  - Reads the workspace's OpenAI key from Orchester's `ai_provider`
 *    and decrypts via AES-256-GCM (same keyring as `lib/encryption`,
 *    inlined so the script doesn't drag `server-only` through tsx).
 *  - Selects unembedded facts straight from the Mnemosyne Postgres —
 *    the HTTP API doesn't yet accept precomputed vectors on writes.
 *  - Calls OpenAI `/v1/embeddings` in batches of 32 and writes
 *    `embedding` / `embedding_model` / `embedding_version` back into
 *    `mnemo_fact`. Bitemporal interval, statement, attribution are
 *    left untouched.
 *
 * Safe to re-run — the SELECT filters by `embedding IS NULL`.
 *
 *   pnpm tsx apps/web/scripts/backfill-mnemo-embeddings.ts
 */

import { config as dotenv } from "dotenv";
import { Client } from "pg";
import crypto from "node:crypto";

dotenv({ path: new URL("../.env", import.meta.url).pathname });
dotenv({ path: new URL("../.env.local", import.meta.url).pathname });

const MNEMO_DSN = process.env.MNEMO_DB_URL ?? "postgresql://mnemo:mnemo@localhost:55435/mnemo";
const ORCH_DSN =
  process.env.DATABASE_URL ?? "postgresql://orchester:orchester@localhost:5432/orchester";
const EMBED_MODEL = process.env.MNEMO_EMBED_MODEL ?? "text-embedding-3-small";
const BATCH = 32;

const VERSION_PREFIX_RE = /^v(\d+):/;
const ALGO = "aes-256-gcm";

function keyForVersion(version: number): Buffer {
  if (version !== 1) {
    throw new Error(`Only version 1 is supported (got v${version}).`);
  }
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) throw new Error("ENCRYPTION_SECRET env var is required");
  if (secret.length !== 64) {
    throw new Error(`ENCRYPTION_SECRET must be 64 hex chars. Got ${secret.length}.`);
  }
  return Buffer.from(secret, "hex");
}

function decrypt(encoded: string): string {
  const match = VERSION_PREFIX_RE.exec(encoded);
  let key: Buffer;
  let ivB64: string | undefined;
  let tagB64: string | undefined;
  let ctB64: string | undefined;
  if (match) {
    key = keyForVersion(Number(match[1]));
    [ivB64, tagB64, ctB64] = encoded.slice(match[0].length).split(":");
  } else {
    key = keyForVersion(1);
    [ivB64, tagB64, ctB64] = encoded.split(":");
  }
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Invalid ciphertext format");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

type FactRow = { id: string; workspace_id: string; statement: string };

async function callOpenAI(apiKey: string, texts: string[]): Promise<number[][]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return json.data.map((d) => d.embedding);
}

async function main(): Promise<void> {
  const mnemo = new Client({ connectionString: MNEMO_DSN });
  await mnemo.connect();
  const orch = new Client({ connectionString: ORCH_DSN });
  await orch.connect();
  console.log("→ Connected to Mnemosyne + Orchester Postgres");

  const counts = await mnemo.query<{ workspace_id: string; n: string }>(
    `SELECT workspace_id, COUNT(*)::text AS n
       FROM mnemo_fact
      WHERE embedding IS NULL
      GROUP BY workspace_id
      ORDER BY 1`
  );
  if (counts.rowCount === 0) {
    console.log("✓ No unembedded facts. Nothing to do.");
    await mnemo.end();
    await orch.end();
    return;
  }
  console.log("→ Workspaces with unembedded facts:");
  for (const r of counts.rows) console.log(`    ${r.workspace_id}: ${r.n}`);

  let totalEmbedded = 0;
  let totalSkipped = 0;

  for (const { workspace_id: wsId } of counts.rows) {
    const provider = await orch.query<{ api_key: string }>(
      `SELECT api_key FROM ai_provider
        WHERE workspace_id = $1 AND provider = 'openai' AND enabled = true
        LIMIT 1`,
      [wsId]
    );
    if (provider.rowCount === 0) {
      console.warn(`⚠️  ${wsId}: no enabled OpenAI provider — skipped`);
      const skipped = await mnemo.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM mnemo_fact
          WHERE workspace_id = $1 AND embedding IS NULL`,
        [wsId]
      );
      totalSkipped += Number(skipped.rows[0]?.n ?? 0);
      continue;
    }
    let apiKey: string;
    try {
      apiKey = decrypt(provider.rows[0]!.api_key);
    } catch (e) {
      console.warn(`⚠️  ${wsId}: cannot decrypt apiKey — ${(e as Error).message}`);
      continue;
    }
    if (!apiKey.startsWith("sk-")) {
      console.warn(`⚠️  ${wsId}: decrypted key doesn't look like an OpenAI key — skipped`);
      continue;
    }

    let pageStart = 0;
    for (;;) {
      const page = await mnemo.query<FactRow>(
        `SELECT id, workspace_id, statement
           FROM mnemo_fact
          WHERE workspace_id = $1 AND embedding IS NULL
          ORDER BY id
          LIMIT $2 OFFSET $3`,
        [wsId, BATCH, pageStart]
      );
      if (page.rowCount === 0) break;
      pageStart += page.rowCount;

      const texts = page.rows.map((r) => r.statement);
      const vectors = await callOpenAI(apiKey, texts);
      await mnemo.query("BEGIN");
      try {
        for (let i = 0; i < page.rows.length; i++) {
          const id = page.rows[i]!.id;
          const vec = vectors[i]!;
          await mnemo.query(
            `UPDATE mnemo_fact
                SET embedding = $1::halfvec(1536),
                    embedding_model = $2,
                    embedding_version = 'orchester-backfill@v1'
              WHERE id = $3 AND workspace_id = $4`,
            [`[${vec.join(",")}]`, EMBED_MODEL, id, wsId]
          );
        }
        await mnemo.query("COMMIT");
      } catch (e) {
        await mnemo.query("ROLLBACK");
        throw e;
      }
      totalEmbedded += page.rows.length;
      console.log(`    ${wsId}: embedded ${page.rows.length} (running total ${totalEmbedded})`);
    }
  }

  console.log("");
  console.log(`✓ Done. Embedded ${totalEmbedded} facts, skipped ${totalSkipped}.`);
  await mnemo.end();
  await orch.end();
}

main().catch((e) => {
  console.error("✗ Backfill failed:", e);
  process.exit(1);
});
