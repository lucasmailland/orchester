// packages/mnemosyne/src/episode/index.ts
//
// Public API barrel for the Mnemosyne v1.4 episode module.
//
// Episodes are rich timeline events (meetings, decisions, milestones)
// that aggregate multiple facts under a narrative. The `MemoryType`
// type is re-exported here as the canonical home for the four-value
// cognitive enum — semantic / episodic / procedural / working.

export {
  createEpisode,
  getEpisode,
  linkFactToEpisode,
  type MemoryType,
  type MnemoEpisode,
  type CreateEpisodeInput,
  type LinkFactToEpisodeInput,
} from "./store";

export { listEpisodes, type ListEpisodesInput } from "./query";

// v2 — synthetic episode id derivation (pure helpers). Used by the
// extraction pipeline to stamp every fact with a stable episode
// reference ahead of migration 0048 (which will promote the
// metadata hint to a real FK column on `mnemo_fact`).
export {
  syntheticEpisodeIdForMessageTurn,
  syntheticEpisodeIdForDocument,
  syntheticEpisodeIdForDay,
  deriveSyntheticEpisodeId,
  type DeriveSyntheticEpisodeIdInput,
} from "./synthetic";
