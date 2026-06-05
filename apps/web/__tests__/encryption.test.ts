import { describe, it, expect, beforeAll } from "vitest";
import crypto from "node:crypto";

beforeAll(() => {
  process.env.ENCRYPTION_SECRET = crypto.randomBytes(32).toString("hex");
});

describe("encryption", () => {
  it("roundtrip plaintext through encrypt/decrypt (versioned format)", async () => {
    const { encrypt, decrypt } = await import("../lib/encryption");
    const plaintext = "sk-ant-api03-very-secret-key-12345";
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toContain(plaintext);
    const parts = encrypted.split(":");
    // Formato versionado: v<N>:<iv>:<tag>:<ct> → 4 partes con prefijo "v\d+".
    expect(parts).toHaveLength(4);
    expect(parts[0]).toMatch(/^v\d+$/);
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
    // parts = [v1, iv, tag, ct]. Tampering el ct dispara el auth tag GCM.
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decrypt(parts.join(":"))).toThrow();
  });

  // ── Back-compat: ciphertext pre-rotación (sin prefijo de versión) ─────────
  // CRÍTICO: si esto falla, perdemos todas las credenciales guardadas en la DB
  // antes de introducir el versionado (provider keys, channel creds, etc.).
  it("decrypts legacy 3-part ciphertext (no version prefix) using v1 key", async () => {
    const { decrypt } = await import("../lib/encryption");
    const plaintext = "legacy-credential-from-before-rotation";
    // Reproducimos exactamente cómo se cifraba antes: AES-256-GCM con la key
    // derivada de ENCRYPTION_SECRET (la misma derivación que sigue valiendo
    // como v1 hoy), y serializamos como "iv:tag:ct" (3 partes, sin "v1:").
    const key = Buffer.from(process.env.ENCRYPTION_SECRET!, "hex");
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const legacy = [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
    expect(legacy.split(":")).toHaveLength(3);
    expect(decrypt(legacy)).toBe(plaintext);
  });

  it("masks short keys to dots", async () => {
    const { maskKey } = await import("../lib/encryption");
    expect(maskKey("short")).toBe("••••••••");
    expect(maskKey("sk-ant-api03-1234567890")).toBe("sk-a••••7890");
  });
});
