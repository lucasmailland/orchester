// packages/mnemosyne/src/types.ts
//
// Cross-cutting type contracts shared across mnemosyne primitives and
// host adapters. Keep this file dependency-free (no Drizzle / pg-boss /
// Next.js imports) so the package stays OSS-extractable.

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
