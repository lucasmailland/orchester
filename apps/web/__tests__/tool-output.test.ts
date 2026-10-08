// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizeToolOutput, redactToolImages, mapToolOutputText } from "@/lib/tool-output";
const image = {
  mediaType: "image/png" as const,
  base64: Buffer.from("private image bytes").toString("base64"),
  name: "evidence.png",
};
describe("transient tool output", () => {
  it("preserves plain strings and JSON output", () => {
    expect(normalizeToolOutput("hello").text).toBe("hello");
    expect(normalizeToolOutput({ ok: true }).text).toBe('{"ok":true}');
  });
  it("wraps only text without flattening images", () => {
    expect(
      mapToolOutputText(
        { text: "evidence", images: [image] },
        (text) => `<untrusted>${text}</untrusted>`
      )
    ).toEqual({ text: "<untrusted>evidence</untrusted>", images: [image] });
  });
  it("redacts nested images, including rejected MIME types, without mutating live data", () => {
    const live = {
      toolCalls: [
        { output: { text: "evidence", images: [image, { ...image, mediaType: "bad" }] } },
      ],
    };
    const stored = redactToolImages(live);
    expect(JSON.stringify(stored)).not.toContain(image.base64);
    expect(JSON.stringify(stored)).toContain("[image: evidence.png, 1 KB]");
    expect(live.toolCalls[0]!.output.images[0]!.base64).toBe(image.base64);
  });
  it("accepts exactly 1 MiB and rejects malformed base64", () => {
    const result = normalizeToolOutput({
      images: [
        { ...image, base64: Buffer.alloc(1024 * 1024).toString("base64") },
        { ...image, name: "broken.png", base64: "not base64!" },
      ],
    });
    expect(result.images).toHaveLength(1);
    expect(result.text).toContain("broken.png");
  });
});

it("handles a text-only typed output", () => {
  expect(normalizeToolOutput({ text: "evidence" })).toEqual({ text: "evidence", images: [] });
});
it("redacts serialized copies alongside their image source", () => {
  const original = { text: "evidence", images: [image] };
  const live = { original, copy: `Evidence: ${JSON.stringify(original)}` };
  expect(JSON.stringify(redactToolImages(live))).not.toContain(image.base64);
});
