import { describe, expect, it } from "vitest";
import { htmlToText } from "@/lib/integrations/html-text";

const TAG_START = /<[a-z!/?]/i;

describe("htmlToText", () => {
  it("keeps the text and drops tags", () => {
    expect(htmlToText("<p>Hello <b>world</b></p><p>bye</p>")).toBe("Hello world\nbye");
  });

  it("drops script and style blocks in any case and with a spaced closing tag", () => {
    expect(htmlToText("a<SCRIPT>alert(1)</SCRIPT >b<style>x{}</style>c")).toBe("a b c");
  });

  it("does not rebuild a tag from nested fragments", () => {
    const out = htmlToText("<scr<b>ipt>alert(1)</scr</b>ipt>");
    expect(out).not.toMatch(TAG_START);
  });

  it("does not turn encoded markup back into a tag", () => {
    const out = htmlToText("&lt;script&gt;alert(1)&lt;/script&gt; and &lt;img src=x&gt;");
    expect(out).not.toMatch(TAG_START);
    expect(out).toContain("alert(1)");
  });

  it("keeps comparisons and ampersands readable", () => {
    expect(htmlToText("<p>a &lt; b &amp;&amp; c &gt; d</p>")).toBe("a < b && c > d");
  });

  it("caps the length", () => {
    expect(htmlToText(`<p>${"x".repeat(50)}</p>`, 10)).toBe(`${"x".repeat(10)}… [truncated]`);
  });

  it("returns an empty string for anything that is not a string", () => {
    expect(htmlToText(null)).toBe("");
    expect(htmlToText(42)).toBe("");
  });
});
