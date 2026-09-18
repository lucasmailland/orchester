-- packages/db/migrations/0057_api_key_explicit_scopes.sql
--
-- Give every existing API key explicit scopes.
--
-- Two shapes predate the scope picker and both mean "everything":
--   * `[]` — read as full access by the runtime, which is a permission rule
--     that fails open.
--   * the old default `["agents:read","agents:write","flows:read","flows:write"]`
--     — which was also full access in practice, because reads were never
--     checked at all, so it reached conversations, knowledge and memory too.
--
-- Writing both out as the full list keeps every key working exactly as it does
-- today while removing the ambiguity. It is deliberately NOT a narrowing: a
-- migration is the wrong place to decide that somebody's integration should
-- lose access. Narrow them from the UI, one at a time, watching last_used_at.
--
-- Once no row has `[]`, the empty-means-full branch in `scopesAllow` can go.
UPDATE api_key
SET scopes = '["agents:read","agents:write","flows:read","flows:write","conversations:read","conversations:write","knowledge:read","knowledge:write","employees:read","employees:write","memory:read","memory:write"]'::jsonb
WHERE revoked_at IS NULL
  AND (
    scopes IS NULL
    OR jsonb_array_length(scopes) = 0
    OR scopes = '["agents:read","agents:write","flows:read","flows:write"]'::jsonb
  );
