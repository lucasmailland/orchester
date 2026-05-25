// packages/mnemosyne/src/index.ts
//
// Public API barrel for @orchester/mnemosyne.
// Multi-tenant memory architecture for AI agents.
// See docs/specs/2026-05-24-mnemosyne-design.md

export const MNEMOSYNE_VERSION = "0.1.0";

// Memory Protocol v1 — frozen system-prompt artifact injected by the host
// agent runtime so every agent knows how/when to use mnemosyne_* tools.
// Bumping MEMORY_PROTOCOL_VERSION invalidates extractions tagged with the
// prior version (see §13 of the design spec).
export { MEMORY_PROTOCOL_V1, MEMORY_PROTOCOL_VERSION } from "./protocol/v1";
