/**
 * End-to-end recall smoke — proves the external memory pipeline works.
 *
 *   pnpm tsx apps/web/scripts/e2e-recall-smoke.ts "<query>"
 *
 * Flow: Orchester reads its OpenAI key (decrypt AES-256-GCM), embeds
 * the query, POSTs `/v1/recall` to Mnemosyne with the vector, prints
 * the ranked facts back.
 */

import { config as dotenv } from "dotenv";
import { Client } from "pg";
import crypto from "node:crypto";

dotenv({ path: new URL("../.env", import.meta.url).pathname });
dotenv({ path: new URL("../.env.local", import.meta.url).pathname });

const ORCH_DSN =
  process.env.DATABASE_URL ?? "postgresql://orchester:orchester@localhost:5432/orchester";
const MNEMO_URL = process.env.MNEMO_URL ?? "http://localhost:3939";
const MNEMO_API_KEY = process.env.MNEMO_API_KEY ?? "";
const WS_ID = process.env["SMOKE_WS_ID"];
if (!WS_ID) throw new Error("Set SMOKE_WS_ID env var to the workspace UUID bound to MNEMO_API_KEY");
const EMBED_MODEL = process.env.MNEMO_EMBED_MODEL ?? "text-embedding-3-small";

const ALGO = "aes-256-gcm";
const VER_RE = /^v(\d+):/;

function keyForVersion(v: number): Buffer {
  if (v !== 1) throw new Error(`only v1 supported (got v${v})`);
  const s = process.env.ENCRYPTION_SECRET;
  if (!s || s.length !== 64) throw new Error("ENCRYPTION_SECRET must be 64 hex chars");
  return Buffer.from(s, "hex");
}

function decrypt(encoded: string): string {
  const m = VER_RE.exec(encoded);
  const key = m ? keyForVersion(Number(m[1])) : keyForVersion(1);
  const rest = m ? encoded.slice(m[0].length) : encoded;
  const [ivB64, tagB64, ctB64] = rest.split(":");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("invalid ciphertext");
  const dec = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
  dec.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([dec.update(Buffer.from(ctB64, "base64")), dec.final()]).toString("utf8");
}

async function embedText(apiKey: string, text: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return j.data[0]!.embedding;
}

async function recall(query: string, vector: number[]): Promise<unknown> {
  const res = await fetch(`${MNEMO_URL}/v1/recall`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${MNEMO_API_KEY}`,
      "x-workspace-id": WS_ID,
    },
    body: JSON.stringify({ query, vector, topK: 5 }),
  });
  if (!res.ok) throw new Error(`Mnemosyne ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main(): Promise<void> {
  const query = process.argv[2] ?? "what does the user prefer";
  console.log(`→ Query  : "${query}"`);
  console.log(`→ WS     : ${WS_ID}`);

  const orch = new Client({ connectionString: ORCH_DSN });
  await orch.connect();
  const row = await orch.query<{ api_key: string }>(
    `SELECT api_key FROM ai_provider
      WHERE workspace_id = $1 AND provider = 'openai' AND enabled = true
      LIMIT 1`,
    [WS_ID]
  );
  await orch.end();
  if (row.rowCount === 0) throw new Error("no enabled OpenAI provider");
  const key = decrypt(row.rows[0]!.api_key);
  console.log(`→ Orch key: ok (${key.length} chars)`);

  const vec = await embedText(key, query);
  console.log(`→ Vector : ${vec.length}-dim from OpenAI`);

  const result = (await recall(query, vec)) as {
    hits: Array<{ id: string; statement?: string; content?: string; score?: number }>;
    debug?: Record<string, unknown>;
  };
  console.log("");
  console.log(`✓ Mnemosyne returned ${result.hits.length} hits`);
  if (result.debug) console.log(`  debug: ${JSON.stringify(result.debug)}`);
  result.hits.forEach((r, i) => {
    console.log(`\n  [${i + 1}] score=${r.score?.toFixed(3) ?? "—"}  id=${r.id}`);
    console.log(`       ${r.statement ?? r.content ?? "(no text)"}`);
  });
}

main().catch((e) => {
  console.error("\n✗ Smoke failed:", e);
  process.exit(1);
});
