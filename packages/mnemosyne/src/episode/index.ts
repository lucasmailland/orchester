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
