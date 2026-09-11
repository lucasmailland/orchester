import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => {
  const t = Object.assign((key: string) => key, {
    raw: () => [],
    rich: (key: string) => key,
    has: () => true,
  });
  return { useTranslations: () => t };
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
    fireEvent.click(screen.getByText("blank.label"));
    expect(screen.getByTestId("phase")).toHaveTextContent("form");
  });

  it("still closes on Escape", () => {
    openPicker();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("phase")).toHaveTextContent("hidden");
  });

  it("still closes from the close button", () => {
    openPicker();
    fireEvent.click(screen.getByLabelText("close"));
    expect(screen.getByTestId("phase")).toHaveTextContent("hidden");
  });
});
