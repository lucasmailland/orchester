// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getConnector } from "@/lib/integrations/registry";
import { odooExecute } from "@/lib/integrations/odoo-client";
vi.mock("@/lib/integrations/odoo-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/odoo-client")>()),
  odooExecute: vi.fn(),
}));
const rpc = vi.mocked(odooExecute);
const bytes = Buffer.from("screenshot evidence").toString("base64");
const attachments = [
  ...Array.from({ length: 5 }, (_, i) => ({
    id: 10 - i,
    name: `screen-${i}.png`,
    mimetype: "image/png",
    file_size: 20_000,
    create_date: `2026-10-0${7 - i}`,
  })),
  { id: 4, name: "log.txt", mimetype: "text/plain", file_size: 10 },
  { id: 3, name: "vector.svg", mimetype: "image/svg+xml", file_size: 10 },
];
const run = (input: Record<string, unknown>) =>
  getConnector("odoo")!.actions.get_task_attachments!.run({}, { id: 12, ...input });
beforeEach(() => rpc.mockReset());
describe("Odoo image evidence", () => {
  it.each([{}, { include_images: false }])("never requests datas by default: %j", async (input) => {
    rpc.mockResolvedValue(attachments);
    const result = await run(input);
    expect(result).toEqual({ attachments });
    // owned search, then the description read; neither asks for file bodies
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]![4]).toEqual(
      expect.objectContaining({ fields: expect.not.arrayContaining(["datas"]) })
    );
  });
  it("reads only the four newest supported image ids, retaining every attachment's metadata", async () => {
    rpc
      .mockResolvedValueOnce(attachments)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(attachments.slice(0, 4).map((a) => ({ id: a.id, datas: bytes })));
    const result = (await run({ include_images: true })) as { text: string; images: unknown[] };
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls[0]![4]).toEqual(
      expect.objectContaining({
        order: "create_date desc, id desc",
        fields: expect.not.arrayContaining(["datas"]),
      })
    );
    expect(rpc.mock.calls[2]!.slice(1)).toEqual([
      "ir.attachment",
      "read",
      [[10, 9, 8, 7]],
      { fields: ["id", "datas"] },
    ]);
    expect(result.images).toHaveLength(4);
    expect(result.images[0]).toEqual({
      name: "screen-0.png",
      mediaType: "image/png",
      base64: bytes,
    });
    for (const a of attachments) expect(result.text).toContain(a.name);
    expect(result.text).toContain("screen-4.png, limit of 4 images");
    expect(result.text).toContain("vector.svg, unsupported MIME type");
  });
  it("does not read known oversized images and rechecks decoded size", async () => {
    rpc
      .mockResolvedValueOnce([{ ...attachments[0], file_size: 1024 * 1024 + 1 }, attachments[1]])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 9, datas: Buffer.alloc(1024 * 1024 + 1).toString("base64") }]);
    const result = (await run({ include_images: true })) as { text: string; images: unknown[] };
    expect(rpc.mock.calls[2]![3]).toEqual([[9]]);
    expect(result.images).toEqual([]);
    expect(result.text).toContain("screen-0.png, exceeds 1 MB");
    expect(result.text).toContain("screen-1.png, exceeds 1 MB");
  });
});
