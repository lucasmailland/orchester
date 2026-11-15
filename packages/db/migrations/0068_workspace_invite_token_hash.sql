-- packages/db/migrations/0068_workspace_invite_token_hash.sql
--
-- Invite tokens are now stored as sha256(token) in hex, and the app looks them
-- up by that hash. Tokens written before this were plaintext (base64url), so
-- without this every invite link already sent would stop working. Hashing them
-- in place keeps those links valid and removes the plaintext at rest.
--
-- A value that is already 64 hex characters is a hash: hashing it again would
-- break that link, so it is left alone. Re-running this is a no-op.
UPDATE "workspace_invite"
SET "token" = encode(sha256(convert_to("token", 'UTF8')), 'hex')
WHERE "token" !~ '^[0-9a-f]{64}$';
