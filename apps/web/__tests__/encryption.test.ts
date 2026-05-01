import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";

beforeAll(() => {
  process.env.ENCRYPTION_SECRET = crypto.randomBytes(32).toString("hex");
});

describe("encryption", () => {
  it("roundtrip plaintext through encrypt/decrypt", async () => {
    const { encrypt, decrypt } = await import("../lib/encryption");
    const plaintext = "sk-ant-api03-very-secret-key-12345";
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toContain(plaintext);
    expect(encrypted.split(":")).toHaveLength(3);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it("produces different ciphertext each call (random IV)", async () => {
    const { encrypt } = await import("../lib/encryption");
    const a = encrypt("hello");
    const b = encrypt("hello");
    expect(a).not.toBe(b);
  });

  it("throws on tampered ciphertext", async () => {
    const { encrypt, decrypt } = await import("../lib/encryption");
    const e = encrypt("hello");
    const parts = e.split(":");
    parts[2] = Buffer.from("tampered").toString("base64");
    expect(() => decrypt(parts.join(":"))).toThrow();
  });

  it("masks short keys to dots", async () => {
    const { maskKey } = await import("../lib/encryption");
    expect(maskKey("short")).toBe("••••••••");
    expect(maskKey("sk-ant-api03-1234567890")).toBe("sk-a••••7890");
  });
});
