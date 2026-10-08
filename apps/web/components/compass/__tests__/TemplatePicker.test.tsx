import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Namespace-aware like the real hook: a key resolves to its full path, so the
// test does not depend on how the component scopes its translators.
vi.mock("next-intl", () => {
  const make = (ns?: string) => {
    const full = (key: string) => (ns ? `${ns}.${key}` : key);
    return Object.assign(full, {
      raw: () => [],
      rich: full,
      has: () => true,
    });
  };
  return { useTranslations: (ns?: string) => make(ns) };
});

import { TemplatePicker } from "../TemplatePicker";
import { useTemplateCreateFlow } from "@/lib/compass/use-template-create-flow";

// Wired exactly like the four "+ New" pages (Agents, Flows, Channels,
// Knowledge): the picker is open while phase === "picker", and its onClose is
// the hook's closeAll.
function Harness() {
  const flow = useTemplateCreateFlow("agent");
  return (
    <>
      <button type="button" onClick={flow.openPicker}>
        abrir
      </button>
      <output data-testid="phase">{flow.phase}</output>
      <output data-testid="template">{flow.selectedTemplate?.id ?? ""}</output>
      <TemplatePicker
        kind="agent"
        isOpen={flow.phase === "picker"}
        onClose={flow.closeAll}
        onSelect={(template) =>
          template.blank ? flow.openBlankForm() : flow.selectTemplate(template)
        }
      />
    </>
  );
}

function openPicker() {
  render(<Harness />);
  fireEvent.click(screen.getByText("abrir"));
  expect(screen.getByTestId("phase")).toHaveTextContent("picker");
}

describe("TemplatePicker inside the create flow", () => {
  it("opens the form with the picked template", () => {
    // Picking used to call onSelect and then onClose. React batched both
    // updates, closeAll ran last, and the form never appeared.
    openPicker();
    const cards = screen.getAllByRole("listitem").map((li) => li.querySelector("button")!);
    const nonBlank = cards[1]!;
    fireEvent.click(nonBlank);

    expect(screen.getByTestId("phase")).toHaveTextContent("form");
    expect(screen.getByTestId("template").textContent).not.toBe("");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the blank form from the blank card", () => {
    openPicker();
    fireEvent.click(screen.getByText("compass.templates.agent.blank.label"));
    expect(screen.getByTestId("phase")).toHaveTextContent("form");
  });

  it("still closes on Escape", () => {
    openPicker();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("phase")).toHaveTextContent("hidden");
  });

  it("still closes from the close button", () => {
    openPicker();
    fireEvent.click(screen.getByLabelText("compass.templates.shell.close"));
    expect(screen.getByTestId("phase")).toHaveTextContent("hidden");
  });
});
