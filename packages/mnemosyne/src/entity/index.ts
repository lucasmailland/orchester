// packages/mnemosyne/src/entity/index.ts
//
// Public API barrel for the Mnemosyne v1.6 entity module.
//
// Entities are the 4th cognitive primitive alongside fact, decision,
// and episode. A canonical "thing" (person / organization / project /
// concept / place / other) that facts can reference via
// `mnemo_fact.entity_id`.

export {
  createEntity,
  getEntity,
  updateEntity,
  findByAlias,
  findOrCreate,
  type EntityKind,
  type MnemoEntity,
  type CreateEntityInput,
  type UpdateEntityInput,
  type FindOrCreateInput,
} from "./store";

export {
  listEntities,
  listFactsForEntity,
  type ListEntitiesInput,
  type ListFactsForEntityInput,
} from "./query";

export {
  extractEntities,
  type EntityCandidate,
  type ExtractEntitiesInput,
  type EntityLlmCallFn,
} from "./extract";
