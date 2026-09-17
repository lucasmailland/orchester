import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
import { FlowDocsPanel, SPEC_TEMPLATE } from "./FlowDocsPanel";

describe("FlowDocsPanel", () => {
  it("offers the template for an empty spec", () => {
    const onChange = vi.fn();
    render(<FlowDocsPanel spec="" onChange={onChange} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "useTemplate" }));
    expect(onChange).toHaveBeenCalledWith(SPEC_TEMPLATE);
  });
  it("edits and previews without rendering raw HTML", () => {
    const onChange = vi.fn();
    render(
      <FlowDocsPanel
        spec={"## Purpose\n<img src=x onerror=alert(1)>"}
        onChange={onChange}
        onClose={() => {}}
      />
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "## Steps" } });
    expect(onChange).toHaveBeenCalledWith("## Steps");
    fireEvent.click(screen.getByRole("button", { name: "preview" }));
    expect(screen.getByRole("heading", { name: "Purpose" })).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});
