import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
const send = vi.fn().mockResolvedValue({});
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = send;
  },
  DeleteObjectCommand: class {
    constructor(public input: unknown) {}
  },
  GetObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));

beforeEach(() => {
  process.env["STORAGE_BACKEND"] = "s3";
  process.env["GDPR_EXPORT_BUCKET"] = "test-bucket";
});

describe("S3 export storage", () => {
  it("deleteExport sends DeleteObjectCommand for the key", async () => {
    const { deleteExport } = await import("@/lib/gdpr/storage");
    await deleteExport("w/j.zip");
    expect(send).toHaveBeenCalledWith({ input: { Bucket: "test-bucket", Key: "w/j.zip" } });
  });

  it("regenerateSignedUrl throws for an already-expired export", async () => {
    const { regenerateSignedUrl } = await import("@/lib/gdpr/storage");
    await expect(
      regenerateSignedUrl("w/j.zip", new Date(Date.now() - 8 * 86_400_000))
    ).rejects.toThrow("export_expired");
  });
});
