import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  flows: [] as Array<Record<string, unknown>>,
  versions: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  /** Every repository call, in order, to check what ran inside the one transaction. */
  log: [] as string[],
  transactions: 0,
  failUpdate: false,
  quota: true,
}));

vi.mock("@/lib/flows/flow-repo", () => ({
  withRepo: async (_actor: unknown, fn: (repo: unknown) => Promise<unknown>) => {
    db.transactions++;
    // All-or-nothing like a transaction: on failure, restore what was there.
    const snapshot = structuredClone({ flows: db.flows, versions: db.versions });
    try {
      return await fn({
        findFlow: async (id: string, ws: string) =>
          db.flows.find((f) => f.id === id && f.workspaceId === ws),
        insertFlow: async (row: Record<string, unknown>) => {
          db.log.push(`insert:${String(row.id)}`);
          db.flows.push(row);
          return row;
        },
        snapshotFlow: async (flow: Record<string, unknown>, _ws: string, label: string | null) => {
          db.log.push(`snapshot:${String(flow.id)}`);
          db.versions.push({ flowId: flow.id, version: flow.version, label, nodes: flow.nodes });
          return ((flow.version as number) ?? 1) + 1;
        },
        updateFlow: async (id: string, ws: string, patch: Record<string, unknown>) => {
          db.log.push(`update:${id}`);
          if (db.failUpdate) throw new Error("db down");
          const f = db.flows.find((x) => x.id === id && x.workspaceId === ws);
          if (f) Object.assign(f, patch);
          return f;
        },
        audit: async (_ws: string, entry: Record<string, unknown>) => void db.audits.push(entry),
      });
    } catch (e) {
      db.flows = snapshot.flows;
      db.versions = snapshot.versions;
      throw e;
    }
  },
}));
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async (e: Record<string, unknown>) => void db.audits.push(e)),
}));
vi.mock("@/lib/billing/quotas", () => ({
  checkQuota: vi.fn(async () =>
    db.quota ? { allowed: true } : { allowed: false, reason: "Flow quota exceeded" }
  ),
}));
let ids = 0;
vi.mock("@paralleldrive/cuid2", () => ({ createId: () => `new_${++ids}` }));

const svc = await import("@/lib/flows/service");

const user = { kind: "user", workspaceId: "ws_a", userId: "user_1" } as const;
const key = { kind: "apiKey", workspaceId: "ws_a", keyId: "key_1" } as const;
const n = (id: string, type: string, config: Record<string, unknown> = {}, x = 0) => ({
  id,
  type,
  label: id,
  config,
  position: { x, y: 0 },
});
const e = (source: string, target: string) => ({ id: `${source}-${target}`, source, target });
const group = {
  id: "g1",
  name: "Shape the note",
  description: "Builds the note text",
  icon: "Wand2",
  nodeIds: ["b", "c"],
};

function seed(extra: Record<string, unknown> = {}) {
  db.flows = [
    {
      id: "f1",
      workspaceId: "ws_a",
      name: "Parent",
      kind: "pipeline",
      enabled: true,
      status: "active",
      version: 3,
      spec: null,
      variables: {},
      nodes: [
        n("t", "trigger", { triggerKind: "manual" }),
        n("a", "integration", { integrationId: "x::get", outputVar: "data" }, 100),
        n("b", "transform", { template: { title: "{{data.title}}" } }, 200),
        n("c", "transform", { template: { note: "{{title}}!" } }, 300),
        n("d", "integration", { integrationId: "x::post", input: { body: "{{note}}" } }, 400),
      ],
      edges: [e("t", "a"), e("a", "b"), e("b", "c"), e("c", "d")],
      groups: [group],
      ...extra,
    },
    { id: "f_other", workspaceId: "ws_b", name: "Theirs", nodes: [], edges: [], groups: [group] },
  ];
}

beforeEach(() => {
  ids = 0;
  db.versions = [];
  db.audits = [];
  db.log = [];
  db.transactions = 0;
  db.failUpdate = false;
  db.quota = true;
  seed();
});

describe("previewing an extraction", () => {
  it("returns the plan and writes nothing", async () => {
    const r = await svc.previewExtraction(user, "f1", { groupId: "g1" });
    expect(r.ok).toBe(true);
    expect(r.ok && r.plan).toMatchObject({
      nodeIds: ["b", "c"],
      inputs: ["data"],
      outputs: ["note"],
      staysInside: ["title"],
      kind: "action",
    });
    expect(db.log).toEqual([]);
  });

  it("returns the reasons when the steps cannot move", async () => {
    // The last step: nothing leaves it.
    const r = await svc.previewExtraction(user, "f1", { nodeIds: ["d"] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues[0]?.message).toMatch(/leave the steps/);
  });

  it("never sees another workspace's flow", async () => {
    await expect(svc.previewExtraction(user, "f_other", { groupId: "g1" })).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("applying an extraction", () => {
  it("creates the new flow enabled and active, as an action, in one transaction", async () => {
    const { child, parent, plan } = await svc.extractToFlow(user, "f1", { groupId: "g1" });
    expect(db.transactions).toBe(1);
    expect(db.log).toEqual(["insert:new_1", "snapshot:f1", "update:f1"]);
    expect(child).toMatchObject({
      id: "new_1",
      workspaceId: "ws_a",
      name: "Shape the note",
      description: "Builds the note text",
      kind: "action",
      enabled: true,
      status: "active",
      externalCallers: [],
      variables: {},
      groups: [],
    });
    expect((child.nodes as Array<{ id: string }>).map((x) => x.id)).toEqual(["trigger", "b", "c"]);
    expect(String(child.spec)).toContain('Extracted from the flow "Parent"');
    expect(plan.kind).toBe("action");

    const sub = (parent.nodes as unknown as Array<Record<string, unknown>>).find(
      (x) => x.type === "subflow"
    );
    expect(sub).toMatchObject({
      id: "new_2",
      label: "Shape the note",
      purpose: "Builds the note text",
      config: {
        flowId: "new_1",
        inputs: { data: "{{data}}" },
        outputs: { note: "note" },
        icon: "Wand2",
      },
    });
    expect(parent.groups).toEqual([]);
  });

  it("saves a version of the parent first, so the extraction can be restored", async () => {
    const before = structuredClone(db.flows[0]!.nodes);
    const { parent } = await svc.extractToFlow(user, "f1", { groupId: "g1" });
    expect(db.versions).toHaveLength(1);
    expect(db.versions[0]).toMatchObject({ flowId: "f1", version: 3, nodes: before });
    expect(parent.version).toBe(4);
  });

  it("uses the name, description and icon sent instead of the group's", async () => {
    const { child, parent } = await svc.extractToFlow(user, "f1", {
      groupId: "g1",
      name: "Note text",
      icon: "Bell",
    });
    expect(child.name).toBe("Note text");
    const sub = (parent.nodes as unknown as Array<Record<string, unknown>>).find(
      (x) => x.type === "subflow"
    );
    expect(sub).toMatchObject({ label: "Note text", config: { icon: "Bell" } });
  });

  it("extracts a plain selection, which needs a name", async () => {
    await expect(svc.extractToFlow(user, "f1", { nodeIds: ["b", "c"] })).rejects.toMatchObject({
      code: "invalid",
    });
    const { child } = await svc.extractToFlow(user, "f1", { nodeIds: ["b", "c"], name: "Sel" });
    expect(child.name).toBe("Sel");
  });

  it("makes a pipeline when the block uses AI, and says why", async () => {
    seed({
      nodes: [
        n("t", "trigger", { triggerKind: "manual" }),
        n("a", "integration", { integrationId: "x::get" }),
        n("b", "llm_prompt", { prompt: "Summarize {{appResult}}" }),
        n("c", "transform", { template: { note: "{{texto}}" } }),
        n("d", "integration", { integrationId: "x::post", input: { body: "{{note}}" } }),
      ],
    });
    const { child, plan } = await svc.extractToFlow(user, "f1", { groupId: "g1" });
    expect(child.kind).toBe("pipeline");
    expect(plan.kindReasons.map((r) => r.code)).toEqual(["ai"]);
  });

  it("refuses steps that cannot move, writing nothing", async () => {
    await expect(
      svc.extractToFlow(user, "f1", { nodeIds: ["d"], name: "Tail" })
    ).rejects.toMatchObject({
      code: "invalid",
      issues: [expect.objectContaining({ level: "error" })],
    });
    expect(db.log).toEqual([]);
    expect(db.flows).toHaveLength(2);
  });

  it("refuses when the plan's quota of flows is used up", async () => {
    db.quota = false;
    await expect(svc.extractToFlow(user, "f1", { groupId: "g1" })).rejects.toMatchObject({
      code: "quota",
    });
    expect(db.log).toEqual([]);
  });

  it("leaves nothing behind when the parent update fails", async () => {
    db.failUpdate = true;
    await expect(svc.extractToFlow(user, "f1", { groupId: "g1" })).rejects.toThrow("db down");
    expect(db.flows.map((f) => f.id)).toEqual(["f1", "f_other"]);
    expect(db.versions).toEqual([]);
  });

  it("audits API-key extractions inside the transaction, as a create and an update", async () => {
    await svc.extractToFlow(key, "f1", { groupId: "g1" });
    expect(db.audits.map((a) => a.action)).toEqual(["flow.create", "flow.update"]);
    expect(db.audits.every((a) => a.actorKind === "api_key")).toBe(true);
  });
});
