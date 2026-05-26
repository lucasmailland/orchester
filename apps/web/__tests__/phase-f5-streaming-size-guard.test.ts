// apps/web/__tests__/phase-f5-streaming-size-guard.test.ts
//
// Regression suite for Phase F.5 (post-2026-05-26):
//   The original export pipeline buffered the whole zip in memory
//   with `Buffer.concat` → an OOM kill on multi-GB tenant exports.
//   The fix replaces that with archiver → streaming Upload (S3
//   multipart) / pipeline(createWriteStream(...)) (filesystem),
//   plus a size guard:
//
//     archive.on("data", (chunk) => {
//       bytesSoFar += chunk.length;
//       if (bytesSoFar > MAX_ARCHIVE_BYTES && !aborted) {
//         aborted = true;
//         archive.abort();
//       }
//     });
//
//   When the guard trips, the worker throws `"export_too_large"`
//   from the per-step check AND/OR the post-finalize check; the
//   adapter sees the source error and aborts (S3:
//   `AbortMultipartUpload`; filesystem: `unlink` the partial file).
//
// We exercise the guard by mocking `archiver` so each
// `archive.append(...)` synchronously fires the registered
// `"data"` handler with a chunk we control. That way the size
// accumulator inside `runExportJob` advances DURING the per-step
// loop, and the `bytesSoFar > MAX_ARCHIVE_BYTES` check fires
// exactly where production would.
//
// `MAX_ARCHIVE_BYTES = 1 GiB` is private; we don't lower it. We
// just claim each appended chunk is "more than 1 GiB" (its
// `.length` is the only thing the guard reads) — the test never
// actually allocates a buffer of that size.
import { describe, it, expect, vi, beforeEach } from "vitest";

const ARCHIVER_GIB = 1 * 1024 * 1024 * 1024;

type DataHandler = (chunk: { length: number }) => void;

interface FakeArchive {
  // exactOptionalPropertyTypes: dataHandler is set lazily by the `on`
  // mock when the production code subscribes to "data". Until then it
  // stays `undefined`. With the strict flag enabled, an optional
  // property cannot be assigned `undefined`; spelling it as a union
  // expresses the same intent without tripping the rule.
  dataHandler: DataHandler | undefined;
  appendChunkLengths: number[];
  on: ReturnType<typeof vi.fn>;
  append: ReturnType<typeof vi.fn>;
  finalize: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  pipe: ReturnType<typeof vi.fn>;
  read: ReturnType<typeof vi.fn>;
}

const { archiverFactory, uploadZipMock, archiveRef, setCalls, sendEmailMock } = vi.hoisted(() => {
  const archiveRef = { current: null as FakeArchive | null };
  // Per-test queue: each `archive.append(...)` consumes one entry,
  // treats it as the "byte length" of the appended chunk, and
  // synchronously fires the data handler with that length. Tests set
  // this queue to control when the guard trips.
  const chunkLengthsQueue: number[] = [];

  const factory = vi.fn(() => {
    const fake: FakeArchive = {
      dataHandler: undefined,
      appendChunkLengths: [],
      on: vi.fn((event: string, handler: DataHandler) => {
        if (event === "data") fake.dataHandler = handler;
        return fake;
      }),
      append: vi.fn(() => {
        const len = chunkLengthsQueue.shift() ?? 1024; // default 1 KiB
        fake.appendChunkLengths.push(len);
        if (fake.dataHandler) fake.dataHandler({ length: len });
      }),
      finalize: vi.fn(async () => {}),
      abort: vi.fn(),
      pipe: vi.fn().mockReturnThis(),
      read: vi.fn(),
    };
    archiveRef.current = fake;
    return fake;
  });
  // Attach the queue for test access.
  (factory as unknown as { __queue: number[] }).__queue = chunkLengthsQueue;
  const uploadZipMock = vi.fn();
  // Capture every .set(...) call across every tx.update() chain.
  const setCalls: Array<Record<string, unknown>> = [];
  const sendEmailMock = vi.fn(async () => ({ ok: true }));
  return {
    archiverFactory: factory,
    uploadZipMock,
    archiveRef,
    setCalls,
    sendEmailMock,
  };
});

// ── archiver mock ─────────────────────────────────────────────────
vi.mock("archiver", () => ({ default: archiverFactory }));

// ── storage adapter mock ──────────────────────────────────────────
vi.mock("@/lib/gdpr/storage", () => ({ uploadZip: uploadZipMock }));

// ── tenant cron mock — fresh tx per call so chain return values
// don't leak across invocations. Capture every `.set(payload)`.
vi.mock("@/lib/tenant/cron", () => {
  const jobRow = {
    id: "job_test",
    workspaceId: "ws_test",
    requestedByUserId: "user_test",
    retryCount: 0,
  };

  const makeTx = (): unknown => ({
    select: vi.fn(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([jobRow]),
        }),
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((payload: Record<string, unknown>) => {
        setCalls.push(payload);
        return {
          where: vi.fn(async () => {}),
        };
      }),
    })),
  });

  return {
    withCrossTenantAdmin: vi.fn(async (_label: string, fn: (tx: unknown) => Promise<unknown>) => {
      const tx = makeTx();
      return fn(tx);
    }),
  };
});

// ── exporter mocks: tiny output objects, instant resolution ───────
vi.mock("@/lib/gdpr/exporters/workspace", () => ({
  exportWorkspace: vi.fn(async () => ({ id: "ws_test" })),
}));
vi.mock("@/lib/gdpr/exporters/agents", () => ({
  exportAgents: vi.fn(async () => ({ agents: [] })),
}));
vi.mock("@/lib/gdpr/exporters/conversations", () => ({
  exportConversations: vi.fn(async () => ({ conversations: [] })),
}));
vi.mock("@/lib/gdpr/exporters/messages", () => ({
  exportMessages: vi.fn(async () => ({ messages: [] })),
}));
vi.mock("@/lib/gdpr/exporters/knowledge", () => ({
  exportKnowledge: vi.fn(async () => ({ knowledge: [] })),
}));
vi.mock("@/lib/gdpr/exporters/brain", () => ({
  exportBrain: vi.fn(async () => ({ brain: [] })),
}));

vi.mock("@/lib/gdpr/email", () => ({ sendExportReadyEmail: sendEmailMock }));
vi.mock("@/lib/safe-log", () => ({ safeLogError: vi.fn() }));

vi.mock("@orchester/db", () => ({
  schema: {
    gdprExportJobs: { id: "gdprExportJobs.id" },
    users: { id: "users.id", email: "users.email" },
  },
  getDb: vi.fn(() => ({})),
}));

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return actual;
});

function setChunkLengths(...lengths: number[]): void {
  // Cast through unknown — we stash a private queue on the factory.
  const q = (archiverFactory as unknown as { __queue: number[] }).__queue;
  q.length = 0;
  for (const l of lengths) q.push(l);
}

beforeEach(() => {
  archiverFactory.mockClear();
  uploadZipMock.mockReset();
  archiveRef.current = null;
  setCalls.length = 0;
  sendEmailMock.mockClear();
  setChunkLengths();
});

describe("Phase F.5 regression — archive size guard trips at MAX_ARCHIVE_BYTES", () => {
  it("trips abort() and surfaces export_too_large when an append pushes total bytes > 1 GiB", async () => {
    uploadZipMock.mockResolvedValue({
      signedUrl: "https://x/y.zip",
      expiresAt: new Date(Date.now() + 60_000),
    });

    // First archive.append() fires a chunk just over 1 GiB → trips
    // the guard inside the first iteration of the STEPS loop.
    // Subsequent appends won't be reached (the throw exits the loop).
    setChunkLengths(ARCHIVER_GIB + 1);

    const { runExportJob } = await import("@/lib/gdpr/export-job");
    await runExportJob("job_test");

    expect(archiveRef.current).not.toBeNull();
    // abort() called exactly once by the size-guard listener.
    expect(archiveRef.current!.abort).toHaveBeenCalledTimes(1);
    // The failure UPDATE landed on the job row.
    const failureSet = setCalls.find((s) => s["state"] === "failed");
    expect(failureSet).toBeDefined();
    expect(String(failureSet?.["error"])).toContain("export_too_large");
    // No "completed" set was ever issued.
    expect(setCalls.find((s) => s["state"] === "completed")).toBeUndefined();
  });

  it("abort() is called EXACTLY ONCE even if multiple oversized chunks arrive", async () => {
    uploadZipMock.mockResolvedValue({
      signedUrl: "url",
      expiresAt: new Date(Date.now() + 60_000),
    });
    // Three back-to-back oversized appends inside the same loop
    // iteration would each fire the data handler. The `aborted` flag
    // in export-job.ts is the only thing that prevents a double-abort
    // — if a future refactor drops the flag, this test fires because
    // abort gets called multiple times.
    //
    // We schedule the over-cap chunk on the FIRST append; the worker
    // throws after that iteration's progress UPDATE, so subsequent
    // appends never happen. We still verify the `&& !aborted` guard
    // by directly invoking the data handler again after the abort
    // (simulating archiver's behaviour of flushing pending bytes
    // before propagating the abort error).
    setChunkLengths(ARCHIVER_GIB + 1);

    const { runExportJob } = await import("@/lib/gdpr/export-job");
    const runPromise = runExportJob("job_test");

    // Yield until we have an archive ref. The first append happens
    // inside the loop; once it does, the data handler exists.
    await new Promise((resolve) => setImmediate(resolve));

    await runPromise;

    expect(archiveRef.current!.abort).toHaveBeenCalledTimes(1);

    // Now simulate archiver emitting more chunks after we already
    // aborted (this is a quirk of the underlying stream). The
    // handler is still installed; firing it again MUST NOT re-call
    // abort because `aborted` latched to true on the first trip.
    archiveRef.current!.dataHandler!({ length: ARCHIVER_GIB });
    archiveRef.current!.dataHandler!({ length: ARCHIVER_GIB });
    expect(archiveRef.current!.abort).toHaveBeenCalledTimes(1);
  });

  it("does NOT trip when total bytes stay within the cap", async () => {
    uploadZipMock.mockResolvedValue({
      signedUrl: "url",
      expiresAt: new Date(Date.now() + 60_000),
    });
    // Six appends of ~1 MiB each → well under 1 GiB.
    setChunkLengths(...new Array(6).fill(1024 * 1024));

    const { runExportJob } = await import("@/lib/gdpr/export-job");
    await runExportJob("job_test");

    expect(archiveRef.current).not.toBeNull();
    expect(archiveRef.current!.abort).not.toHaveBeenCalled();
    // No "export_too_large" error landed on the job row.
    const failureSet = setCalls.find((s) => String(s["error"] ?? "").includes("export_too_large"));
    expect(failureSet).toBeUndefined();
  });

  it("the size-guard math uses strict > (not >=) at the boundary", async () => {
    // Two chunks of exactly 1/2 GiB → total = 1 GiB (exactly the cap).
    // The check is `> MAX_ARCHIVE_BYTES`, so EQUAL must NOT trip.
    // This guards against an off-by-one regression.
    uploadZipMock.mockResolvedValue({
      signedUrl: "url",
      expiresAt: new Date(Date.now() + 60_000),
    });
    setChunkLengths(
      ARCHIVER_GIB / 2,
      ARCHIVER_GIB / 2,
      // The third+ appends are < 1 byte so total bytes still ≤ cap.
      // We feed exactly six lengths because STEPS.length === 6.
      0,
      0,
      0,
      0
    );

    const { runExportJob } = await import("@/lib/gdpr/export-job");
    await runExportJob("job_test");

    // Sum is exactly cap → no abort.
    expect(archiveRef.current!.abort).not.toHaveBeenCalled();
  });

  it("on trip, uploadPromise resolution is irrelevant (no signedUrl on the failed row)", async () => {
    // The adapter MIGHT resolve or MIGHT reject when the source
    // aborts (S3 multipart abort produces a rejection; filesystem's
    // pipeline path also rejects). Either way the worker MUST NOT
    // persist a signedUrl on the failed row.
    uploadZipMock.mockRejectedValue(new Error("AbortMultipartUpload"));
    setChunkLengths(ARCHIVER_GIB + 1);

    const { runExportJob } = await import("@/lib/gdpr/export-job");
    await runExportJob("job_test");

    // No set call should carry a signedUrl on the failure path.
    for (const s of setCalls) {
      if ("signedUrl" in s) {
        expect(s["signedUrl"]).toBeFalsy();
      }
    }
    // Sanity: failure landed.
    expect(setCalls.find((s) => s["state"] === "failed")).toBeDefined();
  });
});

// ── adapter-side cleanup contract ────────────────────────────────
//
// The size-guard contract on the OTHER end says:
//   • S3 adapter aborts the multipart upload (lib-storage's `Upload`
//     does this internally on a source 'error'), so we don't leak
//     storage cost on the bucket.
//   • Filesystem adapter unlinks the partial file when `pipeline`
//     rejects, so we don't leak multi-GB junk under GDPR_EXPORT_DIR.
//
// We exercise the FilesystemAdapter directly by un-mocking
// `@/lib/gdpr/storage`, then forcing `pipeline` to reject. The
// adapter's catch path MUST call `unlink` on the partial file
// before re-throwing.
describe("Phase F.5 regression — FilesystemAdapter cleanup on source error", () => {
  it("unlinks the partial file when pipeline() rejects (source aborted mid-stream)", async () => {
    vi.resetModules();
    // Un-mock storage so we can import the real FilesystemAdapter.
    vi.doUnmock("@/lib/gdpr/storage");

    // Trap unlink + mkdir; force pipeline to reject (the same error
    // archiver synthesises on abort).
    const unlinkSpy = vi.fn(async () => {});
    const mkdirSpy = vi.fn(async () => {});
    const writeFileSpy = vi.fn(async () => {});
    vi.doMock("node:fs/promises", () => ({
      writeFile: writeFileSpy,
      mkdir: mkdirSpy,
      unlink: unlinkSpy,
    }));
    vi.doMock("node:stream/promises", () => ({
      pipeline: vi.fn(async () => {
        throw new Error("export_too_large");
      }),
    }));
    vi.doMock("node:fs", () => ({
      createWriteStream: vi.fn(() => ({
        end: vi.fn(),
        destroy: vi.fn(),
        on: vi.fn(),
        write: vi.fn(),
      })),
      createReadStream: vi.fn(),
    }));
    vi.doMock("node:stream", () => ({
      Readable: { from: vi.fn(() => ({ pipe: vi.fn(), on: vi.fn() })) },
    }));

    process.env["STORAGE_BACKEND"] = "filesystem";
    process.env["GDPR_EXPORT_DIR"] = "/tmp/orchester-test-exports-f5";

    const storage = await import("@/lib/gdpr/storage");
    // Reset the memoised adapter (in case a prior test in this
    // process already constructed one).
    storage.__resetStorageAdapterForTests();

    // Fake source that quacks like a Readable (has .pipe). The
    // pipeline() mock throws synchronously, triggering the adapter's
    // catch + unlink path.
    const fakeSource = {
      pipe: vi.fn(),
      on: vi.fn(),
    } as unknown as NodeJS.ReadableStream;

    await expect(storage.uploadZip("ws_test/job_test.zip", fakeSource)).rejects.toThrow(
      "export_too_large"
    );

    expect(unlinkSpy).toHaveBeenCalledTimes(1);
    // mock.calls[0] is typed as `[] | undefined` because vitest can't infer
    // the original signature; we've asserted toHaveBeenCalledTimes(1) above
    // so the first call's args definitely exist. Cast through unknown to
    // satisfy the strict mode's no-overlap guard.
    const firstCallArgs = unlinkSpy.mock.calls[0] as unknown as [string];
    const [unlinkPath] = firstCallArgs;
    expect(unlinkPath).toContain("/tmp/orchester-test-exports-f5");
    // The adapter flattens slashes → expect `ws_test_job_test.zip`.
    expect(unlinkPath).toContain("ws_test_job_test.zip");
  });
});
