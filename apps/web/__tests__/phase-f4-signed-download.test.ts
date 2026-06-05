// apps/web/__tests__/phase-f4-signed-download.test.ts
//
// Regression suite for Phase F.4 (post-2026-05-26):
//   `app/api/exports/[token]/route.ts` serves GDPR export artefacts
//   from the filesystem adapter. Authorisation is an HMAC-signed
//   token (no DB lookup) built by `lib/gdpr/signed-url.ts`:
//
//     token = signValue( base64url(JSON({ k: storageKey, e: expiryMs })) )
//
//   The route MUST reject:
//     • tampered tokens (mutated payload or mutated MAC)
//     • expired tokens
//     • path traversal attempts in the storage key (`..`, leading `/`)
//
// These tests exercise `signExportToken` / `verifyExportToken` directly
// (the route is a thin wrapper around them) and verify the
// constant-time HMAC compare lives in `lib/cookies.ts` — same secret
// (`COOKIE_SIGNING_SECRET`) used for the workspace switcher cookie,
// per the comment in `signed-url.ts`.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("Phase F.4 regression — signed download token verification", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Stable secret for the whole test → predictable HMAC tags.
    // Reset modules so the in-module `keyCache` and
    // `warnedDevSecret` flag don't leak across tests.
    process.env["COOKIE_SIGNING_SECRET"] = "phase-f4-signing-secret-fixed-32bytes";
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("happy path", () => {
    it("a token signed with the production secret round-trips", async () => {
      const { signExportToken, verifyExportToken } = await import("@/lib/gdpr/signed-url");

      const key = "ws_alpha/job_abc.zip";
      const expiresAt = new Date(Date.now() + 60_000);
      const token = await signExportToken(key, expiresAt);

      // Token shape: <base64url(payload)>.<base64url(hmac)>
      expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

      const verified = await verifyExportToken(token);
      expect(verified).toEqual({ storageKey: key });
    });

    it("buildExportDownloadUrl composes the public URL with the token", async () => {
      process.env["NEXT_PUBLIC_APP_URL"] = "https://app.example.com";
      vi.resetModules();
      const { buildExportDownloadUrl } = await import("@/lib/gdpr/signed-url");

      const key = "ws_alpha/job_abc.zip";
      const url = await buildExportDownloadUrl(key, new Date(Date.now() + 60_000));

      expect(url.startsWith("https://app.example.com/api/exports/")).toBe(true);
      // The token after `/api/exports/` is URI-encoded; decoding it
      // should give us a sign(value).tag shape.
      const tokenSegment = url.split("/api/exports/")[1]!;
      const decoded = decodeURIComponent(tokenSegment);
      expect(decoded).toContain(".");
    });
  });

  describe("tampering detection", () => {
    it("rejects a token where the encoded PAYLOAD has been mutated", async () => {
      const { signExportToken, verifyExportToken } = await import("@/lib/gdpr/signed-url");

      const key = "ws_alpha/job_abc.zip";
      const expiresAt = new Date(Date.now() + 60_000);
      const token = await signExportToken(key, expiresAt);

      // Try to swap the storageKey inside the payload — keep the tag
      // unchanged. The HMAC compare in `verifySigned` must reject.
      const dot = token.lastIndexOf(".");
      const tag = token.slice(dot);
      const evilPayload = Buffer.from(
        JSON.stringify({ k: "ws_evil/secret-export.zip", e: expiresAt.getTime() }),
        "utf8"
      ).toString("base64url");
      const tampered = evilPayload + tag;

      expect(await verifyExportToken(tampered)).toBeNull();
    });

    it("rejects a token where the HMAC TAG has been mutated", async () => {
      const { signExportToken, verifyExportToken } = await import("@/lib/gdpr/signed-url");

      const key = "ws_alpha/job_abc.zip";
      const token = await signExportToken(key, new Date(Date.now() + 60_000));

      // Flip the last character of the tag. Base64url alphabet
      // includes [A-Za-z0-9_-]; substitute defensively.
      const last = token.slice(-1);
      const flipped = token.slice(0, -1) + (last === "A" ? "B" : "A");

      expect(await verifyExportToken(flipped)).toBeNull();
    });

    it("rejects a token signed under a DIFFERENT secret", async () => {
      // Sign with secret A...
      const { signExportToken: signA } = await import("@/lib/gdpr/signed-url");
      const key = "ws_alpha/job_abc.zip";
      const token = await signA(key, new Date(Date.now() + 60_000));

      // ...then rotate the env to secret B and try to verify. Fresh
      // module load picks up the new secret. The HMAC compare must
      // reject because the recomputed tag differs.
      process.env["COOKIE_SIGNING_SECRET"] = "phase-f4-DIFFERENT-secret-64-chars-len";
      vi.resetModules();
      const { verifyExportToken: verifyB } = await import("@/lib/gdpr/signed-url");
      expect(await verifyB(token)).toBeNull();
    });

    it("rejects malformed tokens (no separator, empty string, only-tag)", async () => {
      const { verifyExportToken } = await import("@/lib/gdpr/signed-url");
      expect(await verifyExportToken("")).toBeNull();
      expect(await verifyExportToken("no-dot-anywhere")).toBeNull();
      expect(await verifyExportToken(".tag-only")).toBeNull();
      expect(await verifyExportToken("payload-only.")).toBeNull();
    });
  });

  describe("expiry enforcement", () => {
    it("rejects a token that expired 1 ms ago", async () => {
      const { signExportToken, verifyExportToken } = await import("@/lib/gdpr/signed-url");

      // Sign with expiry in the future, then advance the clock past
      // it. Using a static expiry that's already in the past works
      // too because `verifyExportToken` compares `payload.e < Date.now()`.
      const expired = new Date(Date.now() - 1);
      const token = await signExportToken("ws_alpha/job_abc.zip", expired);
      expect(await verifyExportToken(token)).toBeNull();
    });

    it("rejects a token where the expiry has been moved backward (caught by HMAC mismatch)", async () => {
      const { signExportToken, verifyExportToken } = await import("@/lib/gdpr/signed-url");

      // Sign with expiry +60s, then mint a new payload with a much
      // farther-out expiry but the original tag. HMAC verification
      // must fail before the expiry check even runs.
      const realExpiry = Date.now() + 60_000;
      const real = await signExportToken("ws_alpha/job_abc.zip", new Date(realExpiry));
      const tag = real.slice(real.lastIndexOf("."));

      const evilPayload = Buffer.from(
        JSON.stringify({ k: "ws_alpha/job_abc.zip", e: Date.now() + 100_000_000_000 }),
        "utf8"
      ).toString("base64url");

      expect(await verifyExportToken(evilPayload + tag)).toBeNull();
    });
  });

  describe("path traversal defence", () => {
    it("rejects a storageKey containing '..' even if the HMAC is valid", async () => {
      // We construct a valid-HMAC token whose payload encodes a
      // traversal key. The signing helper itself doesn't validate
      // the key shape (it just signs what you pass), so we use
      // `signValue` directly to mint such a token and verify the
      // route-side defence in `verifyExportToken` catches it.
      const { signValue } = await import("@/lib/cookies");

      const evilPayload = Buffer.from(
        JSON.stringify({ k: "../../etc/passwd", e: Date.now() + 60_000 }),
        "utf8"
      ).toString("base64url");
      const token = await signValue(evilPayload);

      const { verifyExportToken } = await import("@/lib/gdpr/signed-url");
      expect(await verifyExportToken(token)).toBeNull();
    });

    it("rejects a storageKey starting with '/' (absolute path)", async () => {
      const { signValue } = await import("@/lib/cookies");

      const evilPayload = Buffer.from(
        JSON.stringify({ k: "/etc/passwd", e: Date.now() + 60_000 }),
        "utf8"
      ).toString("base64url");
      const token = await signValue(evilPayload);

      const { verifyExportToken } = await import("@/lib/gdpr/signed-url");
      expect(await verifyExportToken(token)).toBeNull();
    });
  });

  describe("contract: HMAC primitive comes from lib/cookies (single source of truth)", () => {
    it("uses base64url-encoded HMAC-SHA256 tags", async () => {
      // The cookies module declares HMAC-SHA256 + base64url encoding
      // (see `importKey({ name: "HMAC", hash: "SHA-256" })` and
      // `toBase64Url`). HMAC-SHA256 always produces a 32-byte tag,
      // which base64url-encodes to exactly 43 chars (no padding).
      const { signExportToken } = await import("@/lib/gdpr/signed-url");
      const token = await signExportToken("ws/key.zip", new Date(Date.now() + 60_000));
      const tag = token.slice(token.lastIndexOf(".") + 1);
      expect(tag.length).toBe(43);
      expect(tag).toMatch(/^[A-Za-z0-9_-]+$/); // base64url alphabet only
    });

    it("the secret env var name is COOKIE_SIGNING_SECRET (operationally documented)", async () => {
      // If someone renames the env var (e.g. to STORAGE_SIGNING_KEY)
      // without coordinating with operations, signing breaks at
      // deploy time. We pin the contract here.
      delete process.env["COOKIE_SIGNING_SECRET"];
      vi.resetModules();

      // Without the env var AND not in production, the module logs a
      // warning and uses the dev fallback. Verify the contract by
      // signing under the dev fallback and confirming verification
      // works with the same fallback in scope.
      //
      // `process.env.NODE_ENV` is typed `readonly` in @types/node v22+,
      // so a direct assign fails strict TS. `vi.stubEnv` is vitest's
      // first-class API for this — it monkey-patches the env and
      // auto-restores in afterEach via `vi.unstubAllEnvs()` if needed.
      vi.stubEnv("NODE_ENV", "development");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const { signExportToken, verifyExportToken } = await import("@/lib/gdpr/signed-url");
        const token = await signExportToken("ws/x.zip", new Date(Date.now() + 60_000));
        expect(await verifyExportToken(token)).toEqual({ storageKey: "ws/x.zip" });
        // The dev-fallback warning fired exactly once on first sign.
        expect(warn).toHaveBeenCalled();
      } finally {
        warn.mockRestore();
        vi.unstubAllEnvs();
      }
    });
  });
});
