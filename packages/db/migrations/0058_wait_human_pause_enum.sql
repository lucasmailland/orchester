-- wait_human, parte 1 de 2: el estado nuevo, y nada más.
--
-- Va solo a propósito. Postgres rechaza usar un valor de enum recién agregado
-- dentro de la misma transacción que lo agregó:
--
--   ERROR: unsafe use of new value "paused" of enum type flow_run_status
--
-- y el runner envuelve cada migración en una transacción. La 0059 agrega las
-- columnas y los índices que sí lo referencian, ya con el valor confirmado.
--
-- Hasta acá `wait_human` escribía una variable que nadie leía y el motor seguía
-- por la arista de salida: un flow que decía "esperá aprobación" aprobaba solo.

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
