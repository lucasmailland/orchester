-- wait_human: un run puede quedar esperando a una persona.
--
-- Hasta acá `wait_human` escribía una variable que nadie leía y el motor seguía
-- de largo: un flow que decía "esperá aprobación" aprobaba solo. Para frenar de
-- verdad hace falta un estado nuevo y un lugar donde guardar dónde retomar,
-- porque el recorrido de nodos es recursivo y la posición vive en la pila del
-- proceso.

-- Los enums de Postgres no se pueden extender dentro de una transacción en
-- versiones viejas, y repetir el valor da error: por eso el guard.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'flow_run_status' AND e.enumlabel = 'paused'
  ) THEN
    ALTER TYPE "flow_run_status" ADD VALUE 'paused';
  END IF;
END
$$;

ALTER TABLE "flow_run" ADD COLUMN IF NOT EXISTS "paused_node_id" text;
ALTER TABLE "flow_run" ADD COLUMN IF NOT EXISTS "paused_variables" jsonb;
ALTER TABLE "flow_run" ADD COLUMN IF NOT EXISTS "paused_at" timestamp;
ALTER TABLE "flow_run" ADD COLUMN IF NOT EXISTS "approval_token" text;
ALTER TABLE "flow_run" ADD COLUMN IF NOT EXISTS "resolved_by" text;
ALTER TABLE "flow_run" ADD COLUMN IF NOT EXISTS "resolved_decision" text;

-- Para encontrar un run por su token de aprobación sin escanear la tabla. Único
-- porque el token identifica una sola pausa: si dos runs compartieran token,
-- aprobar uno aprobaría al otro.
CREATE UNIQUE INDEX IF NOT EXISTS "flow_run_approval_token_idx"
  ON "flow_run" ("approval_token")
  WHERE "approval_token" IS NOT NULL;

-- Listar lo que está esperando a una persona es la consulta que va a hacer
-- cualquier pantalla de aprobaciones.
CREATE INDEX IF NOT EXISTS "flow_run_paused_idx"
  ON "flow_run" ("workspace_id", "paused_at")
  WHERE "status" = 'paused';
