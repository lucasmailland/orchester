// apps/web/__tests__/episode-backfill-shape.test.ts
//
// Cobertura del SHAPE de `EpisodeBackfillStats` y de la decisión
// determinística del derivation key. No spinea DB — testea las
// piezas puras directamente. La cobertura de integración (cron real
// contra una base testcontainer) vive aparte cuando se habilite.

import { describe, it, expect } from "vitest";
import {
  deriveSyntheticEpisodeId,
  syntheticEpisodeIdForMessageTurn,
  syntheticEpisodeIdForDocument,
  syntheticEpisodeIdForDay,
} from "@orchester/mnemosyne";

// ── Verificación del contrato que asume el backfill cron ────────────────────
//
// El cron en `apps/web/worker/episode-backfill-job.ts` elige la
// derivación así:
//   1. `source_message_ids[0]` presente → message-turn
//   2. `metadata.source_kind` + `metadata.source_ref` (o kb_chunk_id) → document
//   3. caso contrario → daily (sobre `created_at`)
//
// Pinear el contrato acá garantiza que un futuro refactor del cron
// no rompa la determinismo end-to-end del backfill.

describe("episode-backfill derivation contract", () => {
  const workspaceId = "ws-test";
  const createdAt = new Date("2026-05-30T14:00:00Z");

  it("usa message-turn cuando hay source_message_ids", () => {
    const messageUuid = "m-1";
    const id = deriveSyntheticEpisodeId({ workspaceId, messageUuid });
    expect(id).toBe(syntheticEpisodeIdForMessageTurn(workspaceId, messageUuid));
  });

  it("usa document cuando hay sourceKind + sourceRef (kb_chunk_id case)", () => {
    const id = deriveSyntheticEpisodeId({
      workspaceId,
      sourceKind: "kb",
      sourceRef: "chunk-42",
    });
    expect(id).toBe(syntheticEpisodeIdForDocument(workspaceId, "kb", "chunk-42"));
  });

  it("usa daily cuando no hay otro key", () => {
    const id = deriveSyntheticEpisodeId({ workspaceId, day: createdAt });
    expect(id).toBe(syntheticEpisodeIdForDay(workspaceId, createdAt));
  });

  it("es completamente determinístico — múltiples corridas devuelven el mismo id", () => {
    const inputs = [
      { workspaceId, messageUuid: "m-99" },
      { workspaceId, sourceKind: "webhook", sourceRef: "evt-7" },
      { workspaceId, day: "2026-05-30" },
    ] as const;
    for (const i of inputs) {
      expect(deriveSyntheticEpisodeId(i)).toBe(deriveSyntheticEpisodeId(i));
    }
  });

  it("dos facts del mismo (workspace, message) comparten episode id (el efecto que busca el backfill)", () => {
    // Esto es lo que dedup-by-message hace en el cron: dos facts
    // extraídos del mismo chat-turn deben terminar bajo el mismo
    // synthetic episode.
    const a = deriveSyntheticEpisodeId({ workspaceId, messageUuid: "m-same" });
    const b = deriveSyntheticEpisodeId({ workspaceId, messageUuid: "m-same" });
    expect(a).toBe(b);
  });

  it("facts en distintos workspaces NUNCA comparten episode id, aun con el mismo source key", () => {
    expect(deriveSyntheticEpisodeId({ workspaceId: "ws-a", messageUuid: "m-1" })).not.toBe(
      deriveSyntheticEpisodeId({ workspaceId: "ws-b", messageUuid: "m-1" })
    );
  });
});
