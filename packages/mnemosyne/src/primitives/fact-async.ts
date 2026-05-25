// packages/mnemosyne/src/primitives/fact-async.ts
//
// Async-embedding wrapper for createFact (Mnemosyne v1.1 cost
// optimization). The synchronous `createFact` path performs an
// embedding round-trip per fact (~200-500ms each). For high-throughput
// extraction (5 facts per turn × N turns/min) this dominates wall-clock
// AND racks up per-call API overhead.
//
// This wrapper inserts the fact with `embedding = NULL` immediately and
// hands an enqueue callback the (factId, statement) tuple so a host
// worker can batch up to ~100 facts into a single embedding API call.
//
// Recall behavior: Mode A FTS fallback already handles `embedding =
// NULL` (see `recall/search.ts` — the `text_lemmatized` GIN index
// covers the row). So a fact is searchable via FTS the moment it's
// persisted; once the batch worker fills in the vector, hybrid
// semantic+FTS scoring picks it up automatically. Zero user-visible
// degradation between insert and embed.
//
// Design note (additive vs. invasive): rather than threading a new
// flag through `createFact`, we leverage the existing contract — if
// the caller omits `embeddingProvider`/`embeddingModel`/`embedFn`,
// `createFact` already skips the embedding round-trip and persists
// with `embedding = NULL`. So the wrapper simply STRIPS those three
// fields before delegating, leaving `fact.ts` untouched (preserves
// the A3 PII path verbatim).
//
// §0.1: this file is package-clean — no `server-only`, no path aliases.
// The host (apps/web) supplies the enqueue callback; mnemosyne never
// imports pg-boss / BullMQ / Redis.

import { createFact, type CreateFactInput, type MnemoFact } from "./fact";
import type { EnqueueFn } from "../types";

/**
 * Queue name expected by `apps/web/worker/embed-batch-job.ts`. Exposed
 * as a constant so host code can register the worker without typo
 * risk; mnemosyne itself never queues — the host's `enqueueEmbed`
 * callback is free to pick a different name.
 */
export const EMBED_FACT_JOB_NAME = "mnemo.embed.fact";

export interface CreateFactAsyncInput extends Omit<CreateFactInput, "embedding"> {
  /**
   * Host-supplied enqueue callback. When provided, the fact is
   * inserted with `embedding = NULL` (the embedding provider+model+fn
   * are stripped from the delegated call so the sync path in
   * `createFact` skips the API round-trip) and a `mnemo.embed.fact`
   * job is queued with `{ factId, workspaceId, statement }`. The
   * batch worker drains pending jobs, runs a single embedding call
   * for up to ~100 facts at a time, and updates the
   * `mnemo_fact.embedding` column in place.
   *
   * When NOT provided, this wrapper falls through to synchronous
   * `createFact` (back-compat — existing callers keep their behavior
   * unchanged).
   */
  enqueueEmbed?: EnqueueFn;
}

/**
 * Cost-optimized fact creation that defers embedding to a batch worker.
 *
 * Trade-off: a fact created via this wrapper is unembedded for up to
 * one flush interval (~60s). FTS recall hides this latency entirely —
 * the row is searchable via `text_lemmatized` from the first
 * transaction. Hybrid recall (Mode C) will skip the row on vector
 * search until the worker runs, then automatically include it on the
 * next query.
 *
 * @example
 * ```ts
 * import { createFactAsync } from "@orchester/mnemosyne";
 * import { enqueue } from "@/lib/queue";
 *
 * await withMnemoTx(workspaceId, (tx) =>
 *   createFactAsync({
 *     workspaceId, scope: "global", kind: "preference",
 *     subject: "user", statement: "prefers Spanish",
 *     enqueueEmbed: (name, data) => enqueue(name, data).then(() => undefined),
 *     tx,
 *   })
 * );
 * ```
 */
export async function createFactAsync(input: CreateFactAsyncInput): Promise<MnemoFact> {
  // Strip the host-only field before delegating to the pure primitive.
  // We do NOT want to leak the enqueue callback into the primitive's
  // surface area — it stays an additive wrapper concept.
  const { enqueueEmbed, ...rest } = input;

  if (!enqueueEmbed) {
    // Back-compat: no enqueue callback → behave exactly like createFact.
    // This keeps the wrapper safe to introduce in call sites that
    // haven't wired up the queue yet (gradual rollout).
    return createFact(rest);
  }

  // Force the synchronous embedding path off by stripping the
  // embedding inputs. `createFact` only embeds when all three
  // (embeddingProvider, embeddingModel, embedFn) are present AND
  // `embedding` is omitted; by removing them we guarantee NULL
  // embedding without touching `fact.ts` (preserves the A3 PII path
  // byte-for-byte). The batch worker later resolves provider+model
  // from workspace settings (Charter §25) and updates the row.
  const { embeddingProvider: _ep, embeddingModel: _em, embedFn: _ef, ...factInput } = rest;
  // Avoid "unused var" lint hits while making the strip intent obvious.
  void _ep;
  void _em;
  void _ef;

  const fact = await createFact(factInput);

  // Enqueue post-insert. If the enqueue fails the fact is still
  // persisted (and searchable via FTS); the worst case is the fact
  // stays unembedded until the periodic batch sweep picks it up.
  // We do NOT swallow the error here — the caller's transaction is
  // already committed by this point (createFact ran), but a thrown
  // error propagates so the caller's own error path (e.g.
  // extract-job's try/catch around createFact) can log + alert. The
  // host worker `embed-batch-job.ts` ALSO scans for unembedded facts
  // as a backstop (defense in depth).
  await enqueueEmbed(EMBED_FACT_JOB_NAME, {
    factId: fact.id,
    workspaceId: input.workspaceId,
    // Pass the (potentially PII-redacted) statement as written to the
    // row, NOT the raw input.statement — PII redaction happens inside
    // createFact, and we want the embedding to match what's stored.
    statement: fact.statement,
  });

  return fact;
}
