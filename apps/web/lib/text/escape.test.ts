import { describe, it, expect } from "vitest";
import { nrqlEscape, htmlFromText, htmlEscape } from "./escape";

describe("nrqlEscape", () => {
  it("escapes backslashes and single quotes without adding quotes", () => {
    expect(nrqlEscape(`it's a\\b`)).toBe(`it\\'s a\\\\b`);
  });
});

describe("htmlFromText", () => {
  it("escapes angle brackets and ampersands and keeps line breaks", () => {
    expect(htmlFromText("a < b & c\nd")).toBe("a &lt; b &amp; c<br/>d");
  });
});

describe("htmlEscape", () => {
  it("also escapes quotes", () => {
    expect(htmlEscape(`<a href="x">it's</a>\n`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;it&#39;s&lt;/a&gt;<br/>"
    );
  });
});
