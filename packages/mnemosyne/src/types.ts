// packages/mnemosyne/src/types.ts
//
// Cross-cutting type contracts shared across mnemosyne primitives and
// host adapters. Keep this file dependency-free (no Drizzle / pg-boss /
// Next.js imports) so the package stays OSS-extractable.

/**
 * Mnemosyne v1.4 — "Theory of Mind" attribution.
 *
 * Tracks the COGNITIVE provenance of a fact, distinct from `attributedTo`
 * (which records the message-author role) and `sourceMessageIds` (which
 * records the literal evidence). Attribution answers "should the agent
 * treat this as canonical or as the user's perspective?":
 *
 *   • `user_stated`    — the user explicitly said this in conversation.
 *                        Highest trust; the agent should reflect it back.
 *   • `user_belief`    — the user thinks this is true. The agent should
 *                        respect the belief but not propagate it as
 *                        fact (e.g. "the user believes Eric is in HR";
 *                        Eric may have moved teams since).
 *   • `objective_fact` — verifiable canonical knowledge (workspace
 *                        timezone, organisation chart, integration
 *                        endpoint). Agent can quote it without hedging.
 *   • `inferred`       — extraction-pipeline derived without being
 *                        stated. Lowest-trust; useful for recall but
 *                        the agent should treat it as a hypothesis.
 *
 * Default for every legacy row + every v1.4 row whose extraction prompt
 * hasn't been updated yet is `'inferred'` (SQL DEFAULT enforces this).
 * Recall accepts an optional `attributionFilter` to narrow the result
 * set when the agent needs (say) only user-stated facts.
 */
export type Attribution = "user_stated" | "user_belief" | "objective_fact" | "inferred";

/**
 * Host-provided enqueue callback.
 *
 * Mnemosyne does NOT bundle a job queue (pg-boss / BullMQ / Redis would
 * pull the package into a Next.js-only graph). Instead, primitives that
 * defer work (e.g. async embedding via `createFactAsync`) accept this
 * callback and the host (apps/web) supplies the actual queue adapter.
 *
 * The signature mirrors `apps/web/lib/queue.ts::enqueue` (sans the
 * options bag) so adapter glue is trivial:
 *
 * ```ts
 * import { enqueue } from "@/lib/queue";
 * const enqueueEmbed: EnqueueFn = (name, data) =>
 *   enqueue(name, data).then(() => undefined);
 * ```
 */
export type EnqueueFn = (name: string, data: Record<string, unknown>) => Promise<void>;
