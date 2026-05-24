// packages/mnemosyne/src/tx.ts
//
// withMnemoTx — runs `fn` inside a transaction with `app.workspace_id`
// SET LOCAL'd. Required for all mnemo_* table operations because every
// mnemo_* table has RLS+FORCE Pattern A policies that gate on the GUC.
import "server-only";
import { sql } from "drizzle-orm";
import { getDb, type DbClient } from "@orchester/db";

type Tx = DbClient | Parameters<Parameters<DbClient["transaction"]>[0]>[0];

export async function withMnemoTx<T>(workspaceId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`);
    return fn(tx);
  });
}

export type { Tx };
