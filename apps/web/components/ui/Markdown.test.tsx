import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown";

describe("Markdown", () => {
  it("renders bold, lists, code and tables", () => {
    const { container } = render(
      <Markdown
        content={
          "**bold** text\n\n1. one\n2. two\n\n- a\n- b\n\n`inline`\n\n```\nblock\n```\n\n| h1 | h2 |\n|---|---|\n| c1 | c2 |"
        }
      />
    );
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
    expect(container.querySelector("pre code")?.textContent).toContain("block");
    expect(container.querySelector("table")).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "h1" })).toBeInTheDocument();
    expect(container.textContent).not.toContain("**");
  });

  it("shows raw HTML as text and creates no elements", () => {
    const { container } = render(
      <Markdown content={'<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">'} />
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
    expect(container.textContent).toContain("onerror");
  });

  it("renders safe links with hardened attributes", () => {
    render(<Markdown content="[ok](https://example.com) [mail](mailto:a@b.co)" />);
    const a = screen.getByRole("link", { name: "ok" });
    expect(a).toHaveAttribute("href", "https://example.com");
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(screen.getByRole("link", { name: "mail" })).toBeInTheDocument();
  });

  it("does not make javascript: or data: links clickable", () => {
    const { container } = render(
      <Markdown content="[bad](javascript:alert(1)) [d](data:text/html;base64,AAAA)" />
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("bad");
    expect(container.textContent).toContain("d");
  });

  it("does not load remote images", () => {
    const { container } = render(<Markdown content="![the alt](https://evil.test/p.png)" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("the alt");
  });

  it("makes long code and tables scrollable", () => {
    const { container } = render(
      <Markdown content={"```\nx\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |"} />
    );
    expect(container.querySelector("pre")?.className).toContain("overflow-x-auto");
    expect(container.querySelector("table")?.parentElement?.className).toContain("overflow-x-auto");
  });
});
