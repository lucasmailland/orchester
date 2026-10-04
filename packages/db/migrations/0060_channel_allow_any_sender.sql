-- La lista de remitentes vacía pasa a DENEGAR. Esto hace explícito lo que hasta
-- ahora era el default implícito, para no romper lo que ya está andando.
--
-- Antes, `isSenderAllowed` devolvía `true` con la lista ausente o vacía, así que
-- un canal activo sin lista le hablaba a cualquiera. Eso confundía dos cosas
-- distintas: "nadie la configuró todavía" y "la quiero abierta". Ahora se
-- distinguen con `config.allowAnySender`, y sin ese flag el canal se cierra.
--
-- Esta migración le pone el flag a los canales que **hoy están abiertos y
-- funcionando**, para que mañana sigan igual. Tres recortes a propósito:
--
--   1. Sólo `telegram`, `discord` y `slack`: son los tres webhooks que consultan
--      la lista. Ponerle el flag a un canal `web` o `widget` sería dejar en la
--      config un campo que nadie lee.
--
--   2. Sólo `status = 'active'`. Un canal inactivo no está funcionando hoy, así
--      que no hay comportamiento que preservar: estrena el default nuevo y
--      queda cerrado. Si alguien lo reactiva y le hablan, la negativa le dice
--      su propio ID para que se agregue a la lista.
--
--   3. **No** toca los canales con `allowedSenders` mal formada (algo que no es
--      un array). Ese caso ya denegaba antes —el helper falla cerrado— así que
--      ponerle el flag abriría un canal que estaba cerrado. Es lo contrario de
--      preservar.

UPDATE "channel"
SET "config" = COALESCE("config", '{}'::jsonb) || '{"allowAnySender": true}'::jsonb
WHERE "type" IN ('telegram', 'discord', 'slack')
  AND "status" = 'active'
  -- Si alguien ya lo decidió a mano, se respeta.
  AND NOT (COALESCE("config", '{}'::jsonb) ? 'allowAnySender')
  AND (
    NOT (COALESCE("config", '{}'::jsonb) ? 'allowedSenders')
    OR (
      jsonb_typeof(COALESCE("config", '{}'::jsonb) -> 'allowedSenders') = 'array'
      AND jsonb_array_length(COALESCE("config", '{}'::jsonb) -> 'allowedSenders') = 0
    )
  );
