import { describe, expect, it } from "vitest";
import {
  EMBEDDED_IMAGE_CAP,
  extractEmbeddedAttachmentIds,
} from "@/lib/integrations/odoo-embedded-images";

const img = (src: string) => `<p><img src="${src}"></p>`;

describe("extractEmbeddedAttachmentIds", () => {
  it.each([
    ["/web/image/501", 501],
    ["/web/image/502-abc123def/shot.png", 502],
    ["/web/image/503?access_token=xyz", 503],
    ["/web/image/504-hash?access_token=xyz&amp;unique=1", 504],
    ["/web/content/505", 505],
    ["/web/content/506?download=true", 506],
    ["/web/content/507-hash/name.png", 507],
  ])("matches %s", (src, id) => {
    expect(extractEmbeddedAttachmentIds(img(src))).toEqual([id]);
  });

  it("accepts single quotes, unquoted values, extra attributes and upper case", () => {
    const html =
      `<IMG class="a" src='/web/image/1' alt="x">` +
      `<img style="w" SRC=/web/image/2 />` +
      `<img data-src="/web/image/99" src="/web/image/3">`;
    expect(extractEmbeddedAttachmentIds(html)).toEqual([1, 2, 3]);
  });

  it("ignores external, data, non-numeric and other-path sources", () => {
    const html = [
      img("https://example.com/web/image/10"),
      img("//cdn.example.com/web/image/11"),
      img("data:image/png;base64,AAAA"),
      img("/web/image/res.partner/12/avatar"),
      img("/web/image/abc"),
      img("/web/images/13"),
      img("/static/web/image/14"),
      `<img data-src="/web/image/15">`,
      `<a href="/web/image/16">link</a>`,
      `<img>`,
    ].join("");
    expect(extractEmbeddedAttachmentIds(html)).toEqual([]);
  });

  it("deduplicates and keeps document order", () => {
    const html =
      img("/web/image/3") + img("/web/image/1") + img("/web/content/3?x=1") + img("/web/image/2-h");
    expect(extractEmbeddedAttachmentIds(html)).toEqual([3, 1, 2]);
  });

  it("caps the result", () => {
    const html = Array.from({ length: 50 }, (_, i) => img(`/web/image/${i + 1}`)).join("");
    const ids = extractEmbeddedAttachmentIds(html);
    expect(ids).toHaveLength(EMBEDDED_IMAGE_CAP);
    expect(ids[0]).toBe(1);
    expect(extractEmbeddedAttachmentIds(html, 3)).toEqual([1, 2, 3]);
  });

  it.each([undefined, null, false, 42, "", "plain text"])("returns [] for %j", (v) => {
    expect(extractEmbeddedAttachmentIds(v)).toEqual([]);
  });

  it("runs in linear time on hostile 200 KB inputs", () => {
    const inputs = [
      "<img ".repeat(40_000),
      '<img src="' + "/web/image/1".repeat(20_000),
      "<img" + " ".repeat(200_000) + "src",
      "<img src=/web/image/" + "9".repeat(200_000),
      "<".repeat(200_000),
    ];
    for (const html of inputs) {
      const t = performance.now();
      extractEmbeddedAttachmentIds(html);
      expect(performance.now() - t).toBeLessThan(500);
    }
  });
});
