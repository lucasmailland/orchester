import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) =>
    v ? `${k}:${JSON.stringify(v)}` : k,
}));

import { PromptEditor } from "./PromptEditor";

function Harness({ initial }: { initial: string }) {
  const [v, setV] = useState(initial);
  return <PromptEditor value={v} onChange={setV} />;
}

describe("PromptEditor", () => {
  it("shows a rendered preview by default for a non-empty prompt", () => {
    render(<Harness initial={"# Role\n\n**Be** brief\n\n- one\n- two"} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("heading", { name: "Role" })).toBeInTheDocument();
    expect(screen.getByText("Be").tagName).toBe("STRONG");
    expect(screen.getByRole("button", { name: "edit" })).toBeInTheDocument();
  });

  it("Edit shows the textarea with the same value", () => {
    render(<Harness initial="hello **world**" />);
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    expect(screen.getByRole("textbox")).toHaveValue("hello **world**");
    expect(screen.getByRole("button", { name: "preview" })).toBeInTheDocument();
  });

  it("keeps unsaved edits when toggling back and forth", () => {
    render(<Harness initial="original" />);
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "changed **text**" } });
    fireEvent.click(screen.getByRole("button", { name: "preview" }));
    expect(screen.getByText("text").tagName).toBe("STRONG");
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    expect(screen.getByRole("textbox")).toHaveValue("changed **text**");
  });

  it("starts in edit mode when the prompt is empty", () => {
    render(<Harness initial="" />);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("keeps the quality score and counters in both modes", () => {
    render(<Harness initial="some prompt" />);
    expect(screen.getByText(/chars/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    expect(screen.getByText(/chars/)).toBeInTheDocument();
  });
});
