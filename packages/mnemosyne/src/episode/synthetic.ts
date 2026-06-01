// packages/mnemosyne/src/episode/synthetic.ts
//
// v2 — Synthetic episode ID derivation.
//
// Pure helpers used by extraction-time wiring when v2's "every fact
// belongs to exactly one episode" invariant lands (see
// docs/specs/2026-05-30-mnemosyne-v2-design.md §4). Today the cron /
// extraction code does NOT yet stamp `episode_id` on every fact —
// that's gated on migration 0048 (add `is_synthetic` to
// `mnemo_episode`, backfill `episode_id` on `mnemo_fact`). These
// helpers are exported now so:
//
//   1. The wiring contract is reviewable in isolation.
//   2. Host code can start STAMPING the would-be id in metadata
//      (without the FK) ahead of the migration, giving the migration
//      a stable backfill path: "convert metadata.synthetic_episode_id
//      into the real FK column."
//
// All three derivation functions return DETERMINISTIC, REPRODUCIBLE
// ids:
//   - Same input → same output.
//   - No randomness, no clock reads, no LLM calls.
//   - Cross-process safe (UUIDv5-shaped — name-based hash).
//
// Why UUIDv5: it gives us a 128-bit namespaced hash so two host
// processes generating the same synthetic id concurrently (e.g.
// extracting the same chat turn on two pods) produce byte-identical
// ids without coordination. The namespace is a per-mnemosyne fixed
// UUID — the cron / extraction code never has to invent its own.

import { createHash } from "crypto";

// ── Namespace UUIDs (RFC 4122 §4.3, name-based via SHA-1) ────────────────────
//
// One namespace per derivation kind. These are fixed across all
// installs; they CANNOT change without invalidating every previously-
// computed synthetic id. The four bytes after the third dash are the
// `1` (RFC version) and `5` markers per the spec.
//
// Generated once by hand. To regenerate (don't), use:
//   crypto.randomUUID().replace(/^(.{14})./, "$15")
// Then update + bump MEMORY_PROTOCOL_VERSION.

const NS_MESSAGE_TURN = "5b1a8b40-1234-5b34-a5e6-7c89abcdef00";
const NS_DOCUMENT = "5b1a8b40-1234-5b34-a5e6-7c89abcdef01";
const NS_DAILY = "5b1a8b40-1234-5b34-a5e6-7c89abcdef02";

// ── Core hash helper ─────────────────────────────────────────────────────────

/**
 * RFC 4122 §4.3 name-based UUID via SHA-1. Drift-free across processes:
 * the same (namespace, name) pair always produces the same UUID.
 *
 * Internal — exported for the test suite to verify determinism.
 */
export function uuidV5(namespace: string, name: string): string {
  const nsBytes = uuidStringToBytes(namespace);
  const nameBytes = Buffer.from(name, "utf8");
  const h = createHash("sha1");
  h.update(nsBytes);
  h.update(nameBytes);
  const bytes = h.digest();

  // Per RFC: set the version (5) and variant (10xxxxxx) bits.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant

  return bytesToUuidString(bytes.subarray(0, 16));
}

function uuidStringToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, "");
  if (hex.length !== 32) {
    throw new Error(`uuidV5: invalid UUID '${uuid}' (expected 32 hex chars after dash strip)`);
  }
  return Buffer.from(hex, "hex");
}

function bytesToUuidString(b: Buffer): string {
  const hex = b.toString("hex");
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    hex.slice(12, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20, 32)
  );
}

// ── Public synthetic-id derivations ──────────────────────────────────────────

/**
 * Synthetic episode id for a fact extracted from a single chat-turn
 * message. The (workspace, message_uuid) pair fully determines the
 * id — re-extracting the same turn (e.g. via the sweeper backfill
 * job, #20) produces the SAME id, so dedup is trivially correct.
 *
 * @param workspaceId  Workspace owner of the fact.
 * @param messageUuid  The chat message that the fact was extracted
 *                     from. Required — without it use
 *                     `syntheticEpisodeIdForDay` instead.
 */
export function syntheticEpisodeIdForMessageTurn(workspaceId: string, messageUuid: string): string {
  return uuidV5(NS_MESSAGE_TURN, `${workspaceId}\x00${messageUuid}`);
}

/**
 * Synthetic episode id for a fact extracted from a document /
 * knowledge-base source (no chat turn). Keyed on the source kind
 * and a stable ref (URL, doc id, chunk hash — caller's choice).
 *
 * @param workspaceId  Workspace owner of the fact.
 * @param sourceKind   Free-text source category ("kb", "webhook",
 *                     "csv_import", etc.). Stable across re-imports.
 * @param sourceRef    Stable reference within the source kind
 *                     (e.g. document id, URL, chunk hash).
 */
export function syntheticEpisodeIdForDocument(
  workspaceId: string,
  sourceKind: string,
  sourceRef: string
): string {
  return uuidV5(NS_DOCUMENT, `${workspaceId}\x00${sourceKind}\x00${sourceRef}`);
}

/**
 * Synthetic episode id for a fact with NO source-of-origin context
 * (direct API write, manual entry, anything else). One bucket per
 * (workspace, UTC day) so the count stays bounded — a workspace
 * with 1000 facts/day gets one synthetic episode per day, not 1000.
 *
 * @param workspaceId  Workspace owner of the fact.
 * @param day          A date object OR a YYYY-MM-DD string. The day
 *                     is interpreted in UTC; pass a local-tz date and
 *                     boundary facts may land in the "wrong" bucket
 *                     (acceptable: synthetic ids are never user-
 *                     facing).
 */
export function syntheticEpisodeIdForDay(workspaceId: string, day: Date | string): string {
  const dayStr = typeof day === "string" ? day : day.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayStr)) {
    throw new Error(`syntheticEpisodeIdForDay: invalid day '${dayStr}' (expected YYYY-MM-DD)`);
  }
  return uuidV5(NS_DAILY, `${workspaceId}\x00${dayStr}`);
}

/**
 * Convenience: derive the appropriate synthetic id based on which
 * inputs the caller has. The extraction job uses this to avoid
 * branching on every fact write — it just passes whatever it has
 * and gets the right bucket.
 *
 * Precedence (most-specific wins):
 *   1. messageUuid → message-turn id
 *   2. sourceKind + sourceRef → document id
 *   3. otherwise → daily id (uses caller's `day` or NOW)
 *
 * Throws on all-empty input — a fact MUST have at least a
 * workspace+day to derive an id. Tests verify the branches.
 */
export interface DeriveSyntheticEpisodeIdInput {
  workspaceId: string;
  messageUuid?: string;
  sourceKind?: string;
  sourceRef?: string;
  day?: Date | string;
}

export function deriveSyntheticEpisodeId(input: DeriveSyntheticEpisodeIdInput): string {
  if (!input.workspaceId) {
    throw new Error("deriveSyntheticEpisodeId: workspaceId required");
  }
  if (input.messageUuid) {
    return syntheticEpisodeIdForMessageTurn(input.workspaceId, input.messageUuid);
  }
  if (input.sourceKind && input.sourceRef) {
    return syntheticEpisodeIdForDocument(input.workspaceId, input.sourceKind, input.sourceRef);
  }
  // Don't fall back to NOW silently — the spec says synthetic episode
  // ids must be deterministic. If the caller has no day either, they
  // must provide one explicitly so re-runs produce stable output.
  if (!input.day) {
    throw new Error(
      "deriveSyntheticEpisodeId: requires one of {messageUuid, (sourceKind+sourceRef), day}"
    );
  }
  return syntheticEpisodeIdForDay(input.workspaceId, input.day);
}
