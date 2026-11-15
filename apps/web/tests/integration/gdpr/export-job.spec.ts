// apps/web/tests/integration/gdpr/export-job.spec.ts
//
// End-to-end exercise of the GDPR export pipeline against a real
// postgres + filesystem storage adapter. Verifies that:
//   - the worker walks every per-table exporter in order
//   - the produced artefact is a real zip (PK\x03\x04 header)
//   - each step's JSON is reachable as a zip entry with the expected
//     name + parseable shape
//   - state transitions land correctly (pending → exporting → completed)
//   - the email adapter degrades to the stub when RESEND_API_KEY is unset
//
// No S3, no Resend — RESEND_API_KEY is intentionally unset and the
// storage backend is forced to `filesystem` with a sandboxed dir.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createId } from "@paralleldrive/cuid2";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../fixtures/workspaces";

let wsA: WsFixture;
let runExportJob: typeof import("@/lib/gdpr/export-job").runExportJob;
let getDb: typeof import("@orchester/db").getDb;
let schema: typeof import("@orchester/db").schema;
let eq: typeof import("drizzle-orm").eq;
let resetAdapter: typeof import("@/lib/gdpr/storage").__resetStorageAdapterForTests;

let exportDir: string;
const consoleSpy = vi.spyOn(console, "log");

beforeAll(async () => {
  [wsA] = await setupTestWorkspaces();

  // Sandbox the filesystem adapter to a fresh tmpdir so the test
  // can't collide with prior runs or other test files using /tmp.
  exportDir = await fs.mkdtemp(path.join(tmpdir(), "orchester-export-test-"));
  process.env["STORAGE_BACKEND"] = "filesystem";
  process.env["GDPR_EXPORT_DIR"] = exportDir;
  // Force the stub-log path so we don't touch the Resend SDK at all.
  delete process.env["RESEND_API_KEY"];

  ({ runExportJob } = await import("@/lib/gdpr/export-job"));
  ({ getDb, schema } = await import("@orchester/db"));
  ({ eq } = await import("drizzle-orm"));
  ({ __resetStorageAdapterForTests: resetAdapter } = await import("@/lib/gdpr/storage"));
  resetAdapter();
});

afterAll(async () => {
  await teardownTestWorkspaces();
  // Defensive: if beforeAll() failed before `exportDir` was assigned
  // (testcontainer startup hang under load), `fs.rm(undefined, …)`
  // throws a TypeError and masks the real beforeAll error. Guard so
  // the original failure surfaces unobstructed.
  if (exportDir) {
    await fs.rm(exportDir, { recursive: true, force: true });
  }
});

async function seedConversation(wsId: string, agentId: string) {
  const db = getDb();
  const convoId = createId();
  await db.insert(schema.conversations).values({
    id: convoId,
    workspaceId: wsId,
    agentId,
    status: "open",
    customerEmail: "alice@example.com",
    customerName: "Alice",
  });
  await db.insert(schema.messages).values([
    {
      id: createId(),
      conversationId: convoId,
      role: "user",
      content: "hi",
    },
    {
      id: createId(),
      conversationId: convoId,
      role: "assistant",
      content: "hello!",
      model: "claude-sonnet-4-6",
      tokensUsed: 10,
    },
  ]);
  return convoId;
}

describe("runExportJob (filesystem adapter)", () => {
  it("walks the pipeline and writes a real zip containing every per-table JSON", async () => {
    // Seed a couple of conversations + messages on top of the fixture
    // so the messages exporter has something to dump.
    await seedConversation(wsA.id, wsA.agentIds[0]!);
    await seedConversation(wsA.id, wsA.agentIds[1]!);

    const db = getDb();
    const jobId = `exp_${createId()}`;
    await db.insert(schema.gdprExportJobs).values({
      id: jobId,
      workspaceId: wsA.id,
      requestedByUserId: wsA.ownerId,
      state: "pending",
      progress: 0,
    });

    await runExportJob(jobId);

    const jobRows = await db
      .select()
      .from(schema.gdprExportJobs)
      .where(eq(schema.gdprExportJobs.id, jobId));
    const job = jobRows[0];
    expect(job).toBeDefined();
    // Surface the captured error when state isn't completed — keeps
    // the debugging loop short while the pipeline is young.
    if (job!.state !== "completed") {
      // Bubble the captured worker error up so the test diff is
      // actionable instead of "expected completed, got failed".
      throw new Error(`Export job failed: ${job!.error}`);
    }
    expect(job!.state).toBe("completed");
    expect(job!.progress).toBe(100);
    // SEC-9: the worker never persists the signed URL — a DB dump must
    // not leak 7-day live download links. The URL lives in the email
    // only; the polling route regenerates it per request from storageKey.
    expect(job!.signedUrl).toBeNull();
    expect(job!.signedUrlExpiresAt).toBeNull();
    expect(job!.storageKey).toBe(`${wsA.id}/${jobId}.zip`);
    expect(job!.bytesTotal).not.toBeNull();
    expect(Number(job!.bytesTotal)).toBeGreaterThan(0);
    expect(job!.completedAt).toBeInstanceOf(Date);

    // The artefact lives at `${GDPR_EXPORT_DIR}/<flattened-key>` —
    // `FilesystemAdapter.upload()` writes there. Read it directly to
    // verify the bytes (the download route isn't part of this test's
    // scope).
    const flattenedKey = job!.storageKey!.replace(/\//g, "_");
    const filePath = path.join(exportDir, flattenedKey);
    const buf = await fs.readFile(filePath);
    // PK\x03\x04 is the local-file-header magic for zip.
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

    // Round-trip the zip via yauzl to validate the per-entry contents.
    const { entries, parsed } = await unzipToJson(buf);
    expect(entries.sort()).toEqual([
      "agents.json",
      "conversations.json",
      "knowledge.json",
      "messages.json",
      "workspace.json",
    ]);
    expect((parsed["workspace.json"] as { id?: string })?.id).toBe(wsA.id);
    expect((parsed["agents.json"] as { agents?: unknown[] })?.agents?.length).toBe(wsA.agentCount);
    expect(
      (parsed["conversations.json"] as { conversations?: unknown[] })?.conversations?.length
    ).toBe(2);
    expect((parsed["messages.json"] as { messages?: unknown[] })?.messages?.length).toBe(4);
  });

  it("emits the email stub log when RESEND_API_KEY is unset", async () => {
    const db = getDb();
    const jobId = `exp_${createId()}`;
    await db.insert(schema.gdprExportJobs).values({
      id: jobId,
      workspaceId: wsA.id,
      requestedByUserId: wsA.ownerId,
      state: "pending",
      progress: 0,
    });

    consoleSpy.mockClear();
    await runExportJob(jobId);

    const stubLine = consoleSpy.mock.calls
      .map((c) => String(c[0]))
      .find((s) => s.includes("gdpr.email.stub"));
    expect(stubLine).toBeDefined();
    // Don't deep-parse — the line is structured JSON but other test
    // suites might run in parallel and add noise to the spy. The
    // presence of the marker is the contract.
  });

  it("is a no-op when the job row doesn't exist (idempotent on retry)", async () => {
    // pg-boss can re-fire a job whose row was deleted (e.g. workspace
    // hard-deleted between enqueue and run). The worker must not
    // throw — it should observe the missing row and return silently.
    await expect(runExportJob(`exp_${createId()}`)).resolves.toBeUndefined();
  });
});

/**
 * Tiny zip reader: walks every entry and JSON-parses its body when
 * possible. Pulled out so the main assertion block reads top-down.
 */
async function unzipToJson(
  buf: Buffer
): Promise<{ entries: string[]; parsed: Record<string, unknown> }> {
  const yauzl = await import("yauzl");
  const entries: string[] = [];
  const parsed: Record<string, unknown> = {};

  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("yauzl: no zip"));
      zip.readEntry();
      zip.on("entry", (entry) => {
        entries.push(entry.fileName);
        zip.openReadStream(entry, (err2, stream) => {
          if (err2 || !stream) return reject(err2 ?? new Error("yauzl: no stream"));
          const chunks: Buffer[] = [];
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            try {
              parsed[entry.fileName] = JSON.parse(text);
            } catch {
              parsed[entry.fileName] = text;
            }
            zip.readEntry();
          });
          stream.on("error", reject);
        });
      });
      zip.on("end", () => resolve({ entries, parsed }));
      zip.on("error", reject);
    });
  });
}
