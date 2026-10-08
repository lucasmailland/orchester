// An in-memory database for running the real flow engine end to end, nested
// subflow runs included.
//
// `flow-engine-harness.ts` cannot read the ids inside drizzle conditions, so it
// attributes writes by order and hands a subflow step a canned child output.
// That is enough for one flow, not for proving that a parent behaves the same
// before and after part of it moves into a child. Here `eq`/`and` build plain
// predicates (the test mocks drizzle-orm with them), so every select, insert
// and update hits the right row of the right table, and a subflow step reads
// back the output its child run really wrote.
import { vi } from "vitest";

type Row = Record<string, unknown>;
type TableName = "flows" | "flowRuns" | "flowRunSteps" | "agents";
interface Column {
  table: TableName;
  name: string;
}
type Cond = { op: "eq"; col: Column; value: unknown } | { op: "and"; conds: Cond[] };

export const tables: Record<TableName, Row[]> = {
  flows: [],
  flowRuns: [],
  flowRunSteps: [],
  agents: [],
};

export function resetTables() {
  for (const k of Object.keys(tables) as TableName[]) tables[k] = [];
}

function table(name: TableName, columns: string[]) {
  const t: Record<string, unknown> = { __table: name };
  for (const c of columns) t[c] = { table: name, name: c } satisfies Column;
  return t;
}

export const memSchema = {
  flows: table("flows", ["id", "workspaceId", "name", "lastRunAt", "enabled"]),
  flowRuns: table("flowRuns", ["id", "workspaceId", "flowId", "status", "triggerSource"]),
  flowRunSteps: table("flowRunSteps", ["id", "runId", "nodeId"]),
  agents: table("agents", ["id"]),
};

export const memEq = (col: Column, value: unknown): Cond => ({ op: "eq", col, value });
export const memAnd = (...conds: Cond[]): Cond => ({ op: "and", conds });

function matches(row: Row, cond: Cond | undefined): boolean {
  if (!cond) return true;
  if (cond.op === "and") return cond.conds.every((c) => matches(row, c));
  return row[cond.col.name] === cond.value;
}

const nameOf = (t: unknown) => (t as { __table: TableName }).__table;

/** A drizzle-like result: awaitable, with `limit` and `returning`. */
function result(rows: Row[]) {
  return {
    limit: async (n: number) => rows.slice(0, n),
    returning: async () => rows,
    then: (resolve: (v: Row[]) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
}

const tx = {
  execute: vi.fn(async () => ({ rows: [] })),
  select: () => ({
    from: (t: unknown) => ({
      where: (cond: Cond) =>
        result(tables[nameOf(t)].filter((r) => matches(r, cond)).map((r) => ({ ...r }))),
    }),
  }),
  insert: (t: unknown) => ({
    values: (row: Row) => {
      const copy = structuredClone(row);
      tables[nameOf(t)].push(copy);
      return result([copy]);
    },
  }),
  update: (t: unknown) => ({
    set: (patch: Row) => ({
      where: (cond: Cond) => {
        const hit = tables[nameOf(t)].filter((r) => matches(r, cond));
        for (const r of hit) Object.assign(r, structuredClone(patch));
        return result(hit);
      },
    }),
  }),
};

export const memDb = {
  getDb: () => ({
    ...tx,
    transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  }),
  schema: memSchema,
};
