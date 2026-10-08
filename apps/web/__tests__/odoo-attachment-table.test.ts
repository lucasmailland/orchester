// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getConnector } from "@/lib/integrations/registry";
import { odooExecute } from "@/lib/integrations/odoo-client";
import { buildXlsx } from "./helpers/zip";
vi.mock("@/lib/integrations/odoo-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/odoo-client")>()),
  odooExecute: vi.fn(),
}));
const rpc = vi.mocked(odooExecute);
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64");
const meta = (o: Record<string, unknown> = {}) => ({
  id: 5,
  name: "horas.xlsx",
  mimetype: XLSX,
  file_size: 2000,
  res_model: "project.task",
  res_id: 12,
  ...o,
});
const act = () => getConnector("odoo")!.actions.get_attachment_table!;
const run = (input: Record<string, unknown>) => act().run({}, { attachment_id: 5, ...input });
beforeEach(() => rpc.mockReset());

describe("get_attachment_table", () => {
  it("is a read action", () => expect(act().effect).toBe("read"));

  it("reads an xlsx, masked, after a metadata-only read", async () => {
    rpc.mockResolvedValueOnce([meta()]).mockResolvedValueOnce([{ id: 5, datas: b64(buildXlsx()) }]);
    const out = (await run({ task_id: 12 })) as Record<string, unknown>;
    expect(out).toMatchObject({
      attachment_id: 5,
      name: "horas.xlsx",
      sheet: "Horas",
      columns: ["Name", "Hours", "Note"],
      total_rows: 2,
      truncated: false,
    });
    expect(JSON.stringify(out)).not.toContain("12.345.678");
    expect(rpc.mock.calls[0]![4]).toEqual({
      fields: expect.not.arrayContaining(["datas"]),
    });
    expect(rpc.mock.calls[1]!.slice(1)).toEqual([
      "ir.attachment",
      "read",
      [[5]],
      { fields: ["id", "datas"] },
    ]);
  });

  it("reads a csv by extension even when the mimetype is generic", async () => {
    rpc
      .mockResolvedValueOnce([meta({ name: "x.csv", mimetype: "application/octet-stream" })])
      .mockResolvedValueOnce([{ id: 5, datas: b64("a;b\n20-12345678-9;8,5") }]);
    const out = (await run({})) as { columns: string[]; rows: string[][]; sheet?: string };
    expect(out.columns).toEqual(["a", "b"]);
    expect(out.rows).toEqual([["[num]", "8,5"]]);
  });

  it.each([
    [{ res_model: "res.partner" }, /project\.task/],
    [{ res_id: 99 }, /task/],
  ])("refuses a foreign attachment %j without reading datas", async (patch, re) => {
    rpc.mockResolvedValueOnce([meta(patch)]);
    await expect(run({ task_id: 12 })).rejects.toThrow(re);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("refuses above 5 MB before reading datas", async () => {
    rpc.mockResolvedValueOnce([meta({ file_size: 5 * 1024 * 1024 + 1 })]);
    await expect(run({})).rejects.toThrow(/5 MB/);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("refuses legacy xls with a clear message", async () => {
    rpc.mockResolvedValueOnce([meta({ name: "old.xls", mimetype: "application/vnd.ms-excel" })]);
    await expect(run({})).rejects.toThrow(/xlsx or csv/);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("refuses other formats and missing attachments", async () => {
    rpc.mockResolvedValueOnce([meta({ name: "a.pdf", mimetype: "application/pdf" })]);
    await expect(run({})).rejects.toThrow(/unsupported/i);
    rpc.mockResolvedValueOnce([]);
    await expect(run({})).rejects.toThrow(/not found/i);
  });

  it.each([{ attachment_id: 0 }, { attachment_id: 1.5 }, { attachment_id: "x" }, { task_id: -1 }])(
    "rejects invalid input %j",
    async (bad) => {
      await expect(run(bad)).rejects.toThrow();
      expect(rpc).not.toHaveBeenCalled();
    }
  );

  it("refuses when the decoded payload exceeds the cap despite small metadata", async () => {
    rpc
      .mockResolvedValueOnce([meta({ name: "x.csv", mimetype: "text/csv" })])
      .mockResolvedValueOnce([{ id: 5, datas: b64(Buffer.alloc(5 * 1024 * 1024 + 10, 97)) }]);
    await expect(run({})).rejects.toThrow(/5 MB/);
  });
});

describe("get_task_attachments include_case / max_images", () => {
  const runAtt = (input: Record<string, unknown>) =>
    getConnector("odoo")!.actions.get_task_attachments!.run({}, { id: 12, ...input });
  const img = (id: number, res_id: number, size = 50_000) => ({
    id,
    res_id,
    name: `s${id}.png`,
    mimetype: "image/png",
    file_size: size,
    create_date: "2026-10-01",
  });

  it("reads the task, parent and children in one attachment search, tagging task_id", async () => {
    rpc
      .mockResolvedValueOnce([{ id: 12, parent_id: [3, "P"], child_ids: [20, 21] }])
      .mockResolvedValueOnce([img(9, 12), img(8, 3), img(7, 21)]);
    const out = (await runAtt({ include_case: true })) as {
      attachments: Array<{ id: number; task_id: number }>;
    };
    expect(rpc.mock.calls[1]![3]).toEqual([
      [
        ["res_model", "=", "project.task"],
        ["res_id", "in", [12, 3, 20, 21]],
      ],
    ]);
    expect(out.attachments.map((a) => [a.id, a.task_id])).toEqual([
      [9, 12],
      [8, 3],
      [7, 21],
    ]);
    expect(out.attachments[0]).not.toHaveProperty("res_id");
  });

  it("include_case false keeps today's single search on the task alone", async () => {
    rpc.mockResolvedValueOnce([]);
    await runAtt({});
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]![3]).toEqual([
      [
        ["res_model", "=", "project.task"],
        ["res_id", "=", 12],
      ],
    ]);
  });

  it("honours max_images (1-8) and keeps the rest listed in metadata", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => img(100 - i, 12));
    rpc
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce(rows.slice(0, 6).map((r) => ({ id: r.id, datas: "QUJD" })));
    const out = (await runAtt({ include_images: true, max_images: 6 })) as {
      text: string;
      images: unknown[];
    };
    expect(rpc.mock.calls[1]![3]).toEqual([rows.slice(0, 6).map((r) => r.id)]);
    expect(out.images).toHaveLength(6);
    expect(out.text).toContain("limit of 6 images");
  });

  it.each([
    [0, 1],
    [99, 8],
    [undefined, 4],
    ["x", 4],
  ])("clamps max_images %s to %s", async (given, used) => {
    const rows = Array.from({ length: 10 }, (_, i) => img(100 - i, 12));
    rpc.mockResolvedValueOnce(rows).mockResolvedValueOnce([]);
    await runAtt({ include_images: true, max_images: given });
    expect((rpc.mock.calls[1]![3] as number[][])[0]).toHaveLength(used);
  });

  it("skips images under 10 KB from the payload but lists them", async () => {
    rpc
      .mockResolvedValueOnce([img(2, 12, 9_999), img(1, 12, 10_240)])
      .mockResolvedValueOnce([{ id: 1, datas: "QUJD" }]);
    const out = (await runAtt({ include_images: true })) as {
      text: string;
      images: unknown[];
    };
    expect(rpc.mock.calls[1]![3]).toEqual([[1]]);
    expect(out.images).toHaveLength(1);
    expect(out.text).toContain("s2.png, under 10 KB");
    expect(out.text).toContain('"id":2');
  });
});

describe("model boundary image cap", () => {
  const png = { name: "a.png", mediaType: "image/png", base64: "QUJD" };
  it("keeps 4 by default and honours a declared maxImages up to 8", async () => {
    const { normalizeToolOutput } = await import("@/lib/tool-output");
    const nine = Array.from({ length: 9 }, () => png);
    expect(normalizeToolOutput({ text: "t", images: nine }).images).toHaveLength(4);
    const six = normalizeToolOutput({ text: "t", images: nine, maxImages: 6 });
    expect(six.images).toHaveLength(6);
    expect(six.maxImages).toBe(6);
    expect(normalizeToolOutput({ text: "t", images: nine, maxImages: 99 }).images).toHaveLength(8);
  });
});
