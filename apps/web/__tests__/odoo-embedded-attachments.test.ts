// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getConnector } from "@/lib/integrations/registry";
import { odooExecute } from "@/lib/integrations/odoo-client";
vi.mock("@/lib/integrations/odoo-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/odoo-client")>()),
  odooExecute: vi.fn(),
}));
const rpc = vi.mocked(odooExecute);
const bytes = Buffer.from("screenshot").toString("base64");

type Row = Record<string, unknown>;
const imgHtml = (...ids: number[]) =>
  ids.map((i) => `<img src="/web/image/${i}-h?access_token=t">`).join("");
const att = (id: number, res_id: number, extra: Row = {}): Row => ({
  id,
  name: `s${id}.png`,
  mimetype: "image/png",
  file_size: 50_000,
  create_date: "2026-10-01",
  res_model: "project.task",
  res_id,
  ...extra,
});

interface World {
  tasks: Record<number, Row>;
  attachments: Row[];
}
function world(w: World) {
  rpc.mockImplementation((async (
    _c: unknown,
    model: string,
    method: string,
    args: unknown[],
    kw: Row
  ) => {
    const domain = JSON.stringify(args[0]);
    if (model === "project.task" && method === "read") {
      return (args[0] as number[]).map((i) => w.tasks[i]).filter(Boolean);
    }
    if (model === "project.task" && method === "search_read") {
      const ids = (
        JSON.parse(domain).find((t: unknown[]) => t[0] === "id") as [string, string, number[]]
      )[2];
      return ids.map((i) => w.tasks[i]).filter(Boolean);
    }
    if (model === "ir.attachment" && method === "read") {
      return (args[0] as number[]).map((id) => ({ id, datas: bytes }));
    }
    if (model === "ir.attachment" && method === "search_read") {
      const d = JSON.parse(domain) as unknown[][];
      const byId = d.find((t) => t[0] === "id");
      const byRes = d.find((t) => t[0] === "res_id");
      void kw;
      return w.attachments.filter((a) =>
        byId
          ? (byId[2] as number[]).includes(a.id as number)
          : byRes!.length &&
            (byRes![1] === "="
              ? a.res_id === byRes![2]
              : (byRes![2] as number[]).includes(a.res_id as number))
      );
    }
    throw new Error(`unexpected ${model}.${method}`);
  }) as never);
}
const run = (input: Record<string, unknown>) =>
  getConnector("odoo")!.actions.get_task_attachments!.run({}, { id: 12, ...input }) as Promise<{
    attachments: Array<Record<string, unknown>>;
    text?: string;
    images?: unknown[];
  }>;
beforeEach(() => {
  rpc.mockReset();
});

describe("get_task_attachments: images embedded in the description", () => {
  it("returns images owned by another task, tagged embedded with owner_task_id", async () => {
    world({
      tasks: { 12: { id: 12, description: imgHtml(501, 502, 503) } },
      attachments: [att(501, 7), att(502, 7), att(503, 8)],
    });
    const out = await run({});
    expect(out.attachments).toEqual([
      expect.objectContaining({ id: 501, task_id: 12, embedded: true, owner_task_id: 7 }),
      expect.objectContaining({ id: 502, task_id: 12, embedded: true, owner_task_id: 7 }),
      expect.objectContaining({ id: 503, task_id: 12, embedded: true, owner_task_id: 8 }),
    ]);
  });

  it("serves the embedded images as pixels, in document order, within max_images", async () => {
    world({
      tasks: { 12: { id: 12, description: imgHtml(503, 501, 502) } },
      attachments: [att(501, 7), att(502, 7), att(503, 7)],
    });
    const out = await run({ include_images: true, max_images: 2 });
    expect(out.images).toHaveLength(2);
    const read = rpc.mock.calls.filter((c) => c[1] === "ir.attachment" && c[2] === "read");
    expect(read[0]![3]).toEqual([[503, 501]]);
    expect(out.text).toContain("s502.png, limit of 2 images");
  });

  it("refuses embedded ids that are not images or not project.task attachments", async () => {
    world({
      tasks: { 12: { id: 12, description: imgHtml(601, 602, 603, 604) } },
      attachments: [
        att(601, 7, { mimetype: "application/pdf" }),
        att(602, 7, { res_model: "res.partner" }),
        att(603, 7, { res_model: "hr.employee" }),
        att(604, 7),
      ],
    });
    const out = await run({});
    expect(out.attachments.map((a) => a.id)).toEqual([604]);
  });

  it("never reads embedded ids from tool input", async () => {
    world({
      tasks: { 12: { id: 12, description: "<p>no images</p>" } },
      attachments: [att(701, 7)],
    });
    const out = await run({ embedded_ids: [701], attachment_ids: [701], ids: [701] });
    expect(out.attachments).toEqual([]);
    const searched = rpc.mock.calls.filter((c) => c[1] === "ir.attachment");
    for (const c of searched) expect(JSON.stringify(c[3])).not.toContain("701");
  });

  it("counts an attachment that is both owned and embedded once", async () => {
    world({
      tasks: { 12: { id: 12, description: imgHtml(801, 802) } },
      attachments: [att(801, 12), att(802, 7)],
    });
    const out = await run({});
    expect(out.attachments.map((a) => [a.id, a.embedded ?? false])).toEqual([
      [801, false],
      [802, true],
    ]);
  });

  it("with include_case also covers parent and subtask descriptions", async () => {
    world({
      tasks: {
        12: { id: 12, parent_id: [3, "P"], child_ids: [20], description: "" },
        3: { id: 3, description: imgHtml(901) },
        20: { id: 20, description: imgHtml(902, 901) },
      },
      attachments: [att(901, 99), att(902, 98)],
    });
    const out = await run({ include_case: true });
    expect(out.attachments).toEqual([
      expect.objectContaining({ id: 901, task_id: 3, embedded: true, owner_task_id: 99 }),
      expect.objectContaining({ id: 902, task_id: 20, embedded: true, owner_task_id: 98 }),
    ]);
  });

  it("makes no embedded lookup when no description has images", async () => {
    world({ tasks: { 12: { id: 12, description: "<p>text</p>" } }, attachments: [att(1, 12)] });
    const out = await run({});
    expect(out.attachments.map((a) => a.id)).toEqual([1]);
    expect(out.attachments[0]).not.toHaveProperty("embedded");
    const byId = rpc.mock.calls.filter(
      (c) => c[1] === "ir.attachment" && JSON.stringify(c[3]).includes('"id"')
    );
    expect(byId).toHaveLength(0);
  });
});

describe("get_case: embedded_images", () => {
  it("reports the embedded image count next to the attachment counts", async () => {
    rpc.mockImplementation((async (_c: unknown, model: string, method: string, args: unknown[]) => {
      if (model === "project.task" && method === "read")
        return [{ id: 100, description: imgHtml(1, 2, 3), parent_id: false, child_ids: [101] }];
      if (model === "project.task" && method === "search_read")
        return [
          { id: 101, description: imgHtml(9) + imgHtml(9), parent_id: [100, "x"], child_ids: [] },
        ];
      if (model === "mail.message") return [];
      if (model === "ir.attachment") return [{ id: 50, res_id: 100, mimetype: "image/png" }];
      throw new Error(`unexpected ${model}.${method} ${JSON.stringify(args)}`);
    }) as never);
    const out = (await getConnector("odoo")!.actions.get_case!.run({}, { id: 100 })) as {
      attachments: Record<string, { count: number; images: number; embedded_images: number }>;
    };
    expect(out.attachments["100"]).toEqual({ count: 1, images: 1, embedded_images: 3 });
    expect(out.attachments["101"]).toEqual({ count: 0, images: 0, embedded_images: 1 });
  });
});
