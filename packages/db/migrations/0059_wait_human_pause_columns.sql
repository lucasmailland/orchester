-- wait_human, parte 2 de 2: dónde retomar.
--
-- Separada de la 0058 porque aquella agrega el valor `paused` al enum y
-- Postgres no permite usarlo en la misma transacción. Acá ya está confirmado.
--
-- Por qué hace falta guardar esto. El recorrido de nodos del motor es
-- recursivo: la posición del flow vive en la pila de JavaScript y no sobrevive
-- al proceso. Sin estas columnas, retomar sería volver a correr desde el
-- principio y repetir efectos ya ocurridos — notas escritas, mensajes
-- enviados—, que es justo lo que una pausa tiene que evitar.

ALTER TABLE "flow_run" ADD COLUMN IF NOT EXISTS "paused_node_id" text;
ALTER TABLE "flow_run" ADD COLUMN IF NOT EXISTS "paused_variables" jsonb;
ALTER TABLE "flow_run" ADD COLUMN IF NOT EXISTS "paused_at" timestamp;
ALTER TABLE "flow_run" ADD COLUMN IF NOT EXISTS "approval_token" text;
ALTER TABLE "flow_run" ADD COLUMN IF NOT EXISTS "resolved_by" text;
ALTER TABLE "flow_run" ADD COLUMN IF NOT EXISTS "resolved_decision" text;

-- Encontrar un run por su token sin escanear la tabla. Único porque el token
-- identifica una sola pausa: si dos runs lo compartieran, aprobar uno
-- aprobaría al otro. El token se borra al resolverse, así que el índice sólo
-- cubre lo que está esperando.
CREATE UNIQUE INDEX IF NOT EXISTS "flow_run_approval_token_idx"
  ON "flow_run" ("approval_token")
  WHERE "approval_token" IS NOT NULL;

-- "¿qué está esperando a una persona?" es la consulta de cualquier pantalla de
-- aprobaciones. El predicado usa `approval_token` y no `status = 'paused'`
-- a propósito: el token se limpia al resolver, así que el índice se mantiene
-- chico solo, y además evita referenciar el valor de enum recién creado.
CREATE INDEX IF NOT EXISTS "flow_run_esperando_idx"
  ON "flow_run" ("workspace_id", "paused_at")
  WHERE "approval_token" IS NOT NULL;
