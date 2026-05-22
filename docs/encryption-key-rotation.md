# Encryption key rotation

Symmetric secrets at rest (`ai_provider.api_key`, `channel.credentials_encrypted`,
`workspace_integration.config_encrypted`) are encrypted with AES-256-GCM by
`apps/web/lib/encryption.ts`. The master key is versioned via a small keyring so
it can be rotated without downtime and without manual re-encryption.

## Ciphertext formats

- **Versioned (current):** `v<N>:<iv>:<tag>:<ct>` — `iv`, `tag`, `ct` are
  base64; `N` is the integer key version. `encrypt()` always writes this format
  using the highest registered version.
- **Legacy (read-only):** `<iv>:<tag>:<ct>` (no version prefix). Written before
  versioning existed. `decrypt()` still reads it using the version-1 key derived
  from `ENCRYPTION_SECRET` (the exact same key that produced it), so existing
  rows keep decrypting. **Backward compatibility with these rows is guaranteed.**

## Environment variables

| Var | Required | Meaning |
| --- | --- | --- |
| `ENCRYPTION_SECRET` | yes | 32-byte hex (64 chars). Always registered as **version 1**. Same name and key derivation as before — existing deployments and ciphertext are unaffected. |
| `ENCRYPTION_KEYS` | no | Additional keys for rotation. The **highest** registered version becomes the current write key. |

`ENCRYPTION_KEYS` accepts either:

1. JSON object: `{"1":"<hex>","2":"<hex>"}`
2. Comma-separated `version:hexkey` pairs: `1:<hex>,2:<hex>`

Each key must be a 32-byte hex string (64 chars). If a version is supplied both
via `ENCRYPTION_SECRET` (v1) and `ENCRYPTION_KEYS`, the keys must match or
startup throws.

## Rotation procedure

1. **Generate a new key:** `openssl rand -hex 32`.
2. **Register it at a higher version while keeping the old key available.**
   Going from v1 → v2:
   - `ENCRYPTION_SECRET=<old v1 hex>`  (keeps v1 available for decrypt)
   - `ENCRYPTION_KEYS=2:<new v2 hex>`  (v2 is now the current write key)
3. **Deploy.** New writes use v2; existing v1 (and legacy unversioned) ciphertext
   still decrypts via the registered v1 key.
4. **Migrate stored data** with the re-encrypt script (dry-run first):
   ```
   tsx apps/web/scripts/reencrypt-credentials.ts --dry-run
   tsx apps/web/scripts/reencrypt-credentials.ts
   ```
   It walks `ai_provider`, `channel`, and `workspace_integration`, decrypts each
   secret with the keyring, and re-encrypts at the current version. It is
   **idempotent** (rows already at the current version are skipped) and
   **transaction-safe** per table.
5. **Drop the old key.** Once everything is at v2, remove the v1 entry, keeping
   the live key registered at the highest version. The only hard requirements:
   the highest registered version is the current write key, and every version
   still present in the DB has its key registered.

## Re-encrypt script

- **Location:** `apps/web/scripts/reencrypt-credentials.ts`
- **Env:** `DATABASE_URL`, `ENCRYPTION_SECRET`, optional `ENCRYPTION_KEYS`
- **Flags:** `--dry-run` (or `DRY_RUN=1`) reports would-be changes without writing.

The script intentionally mirrors the keyring logic from `lib/encryption.ts`
rather than importing it, because that module is `server-only`. DB access follows
the same raw `postgres` tagged-template pattern as the pre-existing
`apps/web/scripts/rotate-encryption-secret.ts`.

