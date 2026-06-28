import { describe, it, expect } from "vitest";
import { fetchUrlForIngest } from "@/app/api/knowledge-bases/[id]/docs/url-fetch";

describe("KB url ingest SSRF guard (KNOW-11)", () => {
  it("rejects an internal/metadata URL before fetching", async () => {
    await expect(fetchUrlForIngest("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      /interno|privado|host|private|public/i
    );
  });

  it("rejects a loopback URL", async () => {
    await expect(fetchUrlForIngest("http://127.0.0.1:5432/")).rejects.toThrow(
      /interno|privado|host|private|public/i
    );
  });

  it("rejects a non-http(s) scheme", async () => {
    await expect(fetchUrlForIngest("file:///etc/passwd")).rejects.toThrow(/http/i);
  });
});
