import { describe, it, expect } from "vitest";
import { markdownToHtml } from "./markdown-html";

describe("markdownToHtml blocks", () => {
  it("renders paragraphs and soft line breaks", () => {
    expect(markdownToHtml("one\ntwo\n\nthree")).toBe("<p>one<br>two</p><p>three</p>");
  });

  it("returns an empty string for blank input", () => {
    expect(markdownToHtml("")).toBe("");
    expect(markdownToHtml("  \n\n ")).toBe("");
  });

  it("maps headings to small levels", () => {
    expect(markdownToHtml("# A")).toBe("<h3>A</h3>");
    expect(markdownToHtml("## B")).toBe("<h3>B</h3>");
    expect(markdownToHtml("### C")).toBe("<h4>C</h4>");
    expect(markdownToHtml("###### D ##")).toBe("<h4>D</h4>");
  });

  it("does not treat # without a space, or an ALL CAPS line, as a heading", () => {
    expect(markdownToHtml("#hashtag")).toBe("<p>#hashtag</p>");
    expect(markdownToHtml("SUMMARY")).toBe("<p>SUMMARY</p>");
  });

  it("renders horizontal rules", () => {
    expect(markdownToHtml("a\n\n---\n\nb")).toBe("<p>a</p><hr><p>b</p>");
  });

  it("renders fenced code blocks without formatting inside", () => {
    expect(markdownToHtml("```ts\nconst a = *b* <x>;\n\nok\n```")).toBe(
      "<pre><code>const a = *b* &lt;x&gt;;\n\nok</code></pre>"
    );
  });

  it("closes an unterminated fence at the end of input", () => {
    expect(markdownToHtml("```\nabc")).toBe("<pre><code>abc</code></pre>");
  });

  it("renders unordered lists with any marker", () => {
    expect(markdownToHtml("- a\n* b\n+ c")).toBe("<ul><li>a</li><li>b</li><li>c</li></ul>");
  });

  it("renders ordered lists, even across blank lines", () => {
    expect(markdownToHtml("1. a\n\n2. b")).toBe("<ol><li>a</li><li>b</li></ol>");
  });

  it("lets a list interrupt a paragraph", () => {
    expect(markdownToHtml("Steps:\n- a\n- b")).toBe("<p>Steps:</p><ul><li>a</li><li>b</li></ul>");
  });

  it("renders one nesting level by indentation", () => {
    expect(markdownToHtml("- a\n  - a1\n  - a2\n- b")).toBe(
      "<ul><li>a<ul><li>a1</li><li>a2</li></ul></li><li>b</li></ul>"
    );
    expect(markdownToHtml("1. a\n   - x\n2. b")).toBe(
      "<ol><li>a<ul><li>x</li></ul></li><li>b</li></ol>"
    );
  });

  it("flattens nesting deeper than one level", () => {
    expect(markdownToHtml("- a\n  - b\n      - c")).toBe(
      "<ul><li>a<ul><li>b</li><li>c</li></ul></li></ul>"
    );
  });

  it("does not mistake bold at the start of a line for a list", () => {
    expect(markdownToHtml("**Cause:** x")).toBe("<p><b>Cause:</b> x</p>");
  });
});

describe("markdownToHtml inline", () => {
  it("renders bold and italic", () => {
    expect(markdownToHtml("**a** __b__ *c* _d_")).toBe(
      "<p><b>a</b> <b>b</b> <i>c</i> <i>d</i></p>"
    );
  });

  it("nests italic inside bold", () => {
    expect(markdownToHtml("**a *b* c**")).toBe("<p><b>a <i>b</i> c</b></p>");
  });

  it("leaves snake_case identifiers and arithmetic alone", () => {
    expect(markdownToHtml("call my_func_name and a * b * c")).toBe(
      "<p>call my_func_name and a * b * c</p>"
    );
    expect(markdownToHtml("__init__ and snake_case_x")).toBe("<p><b>init</b> and snake_case_x</p>");
  });

  it("leaves unmatched delimiters as text", () => {
    expect(markdownToHtml("**open and *half")).toBe("<p>**open and *half</p>");
  });

  it("renders inline code without formatting its content", () => {
    expect(markdownToHtml("use `a *b* <c>` now")).toBe(
      "<p>use <code>a *b* &lt;c&gt;</code> now</p>"
    );
  });

  it("supports backslash escapes", () => {
    expect(markdownToHtml("\\*not italic\\*")).toBe("<p>*not italic*</p>");
  });

  it("renders http and https links", () => {
    expect(markdownToHtml("[docs](https://example.com/a?b=1&c=2)")).toBe(
      '<p><a href="https://example.com/a?b=1&amp;c=2">docs</a></p>'
    );
    expect(markdownToHtml("[x](http://example.com)")).toBe(
      '<p><a href="http://example.com">x</a></p>'
    );
  });

  it("renders formatting inside link text", () => {
    expect(markdownToHtml("[**x**](https://e.com)")).toBe(
      '<p><a href="https://e.com"><b>x</b></a></p>'
    );
  });

  it("does not render unsafe links", () => {
    for (const url of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<b>x</b>",
      "//evil.example",
      "/relative",
      "ftp://x.example",
      "https://a b.example",
    ]) {
      const html = markdownToHtml(`[click](${url})`);
      expect(html).not.toContain("<a");
      expect(html).not.toContain("href");
      expect(html).toContain("click");
    }
  });

  it("keeps bare URLs as text", () => {
    expect(markdownToHtml("see https://example.com now")).toBe(
      "<p>see https://example.com now</p>"
    );
  });
});

describe("markdownToHtml escaping", () => {
  it("never lets raw HTML through", () => {
    const html = markdownToHtml(
      '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n<b>hi</b>'
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("escapes HTML inside every construct", () => {
    expect(markdownToHtml("# <i>h</i>")).toBe("<h3>&lt;i&gt;h&lt;/i&gt;</h3>");
    expect(markdownToHtml("- <u>x</u>")).toBe("<ul><li>&lt;u&gt;x&lt;/u&gt;</li></ul>");
    expect(markdownToHtml("**<u>x</u>**")).toBe("<p><b>&lt;u&gt;x&lt;/u&gt;</b></p>");
    expect(markdownToHtml("[<u>x</u>](https://e.com)")).toBe(
      '<p><a href="https://e.com">&lt;u&gt;x&lt;/u&gt;</a></p>'
    );
  });

  it("cannot break out of the href attribute", () => {
    const html = markdownToHtml('[x](https://e.com/"onmouseover="alert(1))');
    // The quotes stay escaped inside href, so the tag has a single attribute.
    expect(html).toMatch(/^<p><a href="[^"]*&quot;onmouseover=&quot;[^"]*">/);
    expect(html.match(/<a [^>]*>/)![0].match(/="/g)).toHaveLength(1);
  });

  it("only ever emits href as an attribute", () => {
    const html = markdownToHtml("# t\n\n- [a](https://e.com) **b**\n\n```\nx\n```\n\n---");
    expect(html.match(/<[a-z0-9]+ [^>]*>/g) ?? []).toEqual(['<a href="https://e.com">']);
  });
});

describe("markdownToHtml performance", () => {
  const timed = (input: string) => {
    const t = Date.now();
    markdownToHtml(input);
    return Date.now() - t;
  };
  const size = 200_000;

  it("renders a 200 KB single line quickly", () => {
    expect(timed("word ".repeat(size / 5))).toBeLessThan(500);
    expect(timed("a".repeat(size))).toBeLessThan(500);
    expect(timed(" ".repeat(size) + "x")).toBeLessThan(500);
  });

  it("renders 200 KB of delimiters quickly", () => {
    expect(timed("*".repeat(size))).toBeLessThan(500);
    expect(timed("_".repeat(size))).toBeLessThan(500);
    expect(timed("`".repeat(size))).toBeLessThan(500);
    expect(timed("*_`".repeat(size / 3))).toBeLessThan(500);
    expect(timed("*a ".repeat(size / 3))).toBeLessThan(500);
    expect(timed("_a ".repeat(size / 3))).toBeLessThan(500);
    expect(timed("[".repeat(size))).toBeLessThan(500);
    expect(timed("[a](".repeat(size / 4))).toBeLessThan(500);
    expect(timed("[a]".repeat(size / 3) + "]")).toBeLessThan(500);
    expect(timed("**a *b `c [d](https://e.com) ".repeat(size / 29))).toBeLessThan(500);
  });

  it("renders many lines and list items quickly", () => {
    expect(timed("- a\n".repeat(size / 4))).toBeLessThan(500);
    expect(timed("  - a\n- b\n".repeat(size / 10))).toBeLessThan(500);
    expect(timed("1. a\n\n".repeat(size / 6))).toBeLessThan(500);
    expect(timed("\n".repeat(size))).toBeLessThan(500);
    expect(timed("```\n".repeat(size / 4))).toBeLessThan(500);
  });
});
