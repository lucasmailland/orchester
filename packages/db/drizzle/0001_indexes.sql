-- Fix F-G3 (v2 meta-audit): índices en columnas de queries calientes.
--
-- Postgres NO indexa automáticamente las columnas de FK. Sin estos índices el
-- reaper (C5), el cap de concurrencia B3, las queries de retención (G1) y las
-- listas paginadas por workspace+fecha terminan en seq-scan no-lineal con el
-- crecimiento de filas.
--
-- Todos los índices son `CREATE INDEX IF NOT EXISTS` → idempotentes; aplican
-- limpio incluso si alguien los creó manualmente. Sin `CONCURRENTLY` para que
-- corran dentro de la transacción de la migración (drizzle envuelve cada
-- migración en una tx). En producción con tablas grandes y carga, conviene
-- recrearlos con CONCURRENTLY en una ventana de mantenimiento — pero los index
-- builds iniciales sobre tablas vacías o pequeñas son instantáneos.

-- ── flow_run ────────────────────────────────────────────────────────────────
-- B3 cap de concurrencia: count(*) FROM flow_run WHERE flow_id=$ AND status IN (..)
CREATE INDEX IF NOT EXISTS idx_flow_run_flow_id_status ON "flow_run" ("flow_id", "status");
-- Reaper + retention: rango por started_at, filter por status.
CREATE INDEX IF NOT EXISTS idx_flow_run_status_started_at ON "flow_run" ("status", "started_at");
-- Listados "últimos runs del flow" en la UI.
CREATE INDEX IF NOT EXISTS idx_flow_run_flow_id_started_at ON "flow_run" ("flow_id", "started_at" DESC);
-- Workspace-scoped retention sweeps + dashboards.
CREATE INDEX IF NOT EXISTS idx_flow_run_workspace_started_at ON "flow_run" ("workspace_id", "started_at" DESC);

-- ── flow_run_step (FK lookup + reaper para steps de runs colgados) ──────────
CREATE INDEX IF NOT EXISTS idx_flow_run_step_run_id ON "flow_run_step" ("run_id");
CREATE INDEX IF NOT EXISTS idx_flow_run_step_status ON "flow_run_step" ("status");

-- ── webhook_delivery (G1 retention + listados por webhook) ──────────────────
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_created_at ON "webhook_delivery" ("created_at");
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_webhook_id ON "webhook_delivery" ("webhook_id", "created_at" DESC);

-- ── audit_log (vista de auditoría + retención 365d) ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_audit_log_workspace_created_at ON "audit_log" ("workspace_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON "audit_log" ("created_at");

-- ── usage_event (billing aggregation por mes + retención 90d) ───────────────
CREATE INDEX IF NOT EXISTS idx_usage_event_workspace_created_at ON "usage_event" ("workspace_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS idx_usage_event_created_at ON "usage_event" ("created_at");

-- ── message (lectura del thread + retención por conv cerrada) ───────────────
CREATE INDEX IF NOT EXISTS idx_message_conversation_created_at ON "message" ("conversation_id", "created_at");
CREATE INDEX IF NOT EXISTS idx_message_created_at ON "message" ("created_at");

-- ── conversations (listado por workspace + dashboard) ───────────────────────
CREATE INDEX IF NOT EXISTS idx_conversation_workspace_started_at ON "conversation" ("workspace_id", "started_at" DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_status ON "conversation" ("status");

-- ── flow_version (retention "keep last N per flow") ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_flow_version_flow_created ON "flow_version" ("flow_id", "created_at" DESC);
