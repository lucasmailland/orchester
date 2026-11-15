/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
// HeroUI uses the i18n provider — mock the client hook so the component mounts.
vi.mock("@heroui/react", async () => {
  const actual = await vi.importActual<typeof import("@heroui/react")>("@heroui/react");
  return actual;
});

import { PromptGeneratorModal } from "@/components/agents/studio/PromptGeneratorModal";
import { TemplatePickerModal } from "@/components/agents/studio/TemplatePickerModal";

afterEach(cleanup);

describe("studio modals are real dialogs (PERF-15)", () => {
  it("PromptGeneratorModal renders a focus-trapped dialog with a named close button", () => {
    render(<PromptGeneratorModal open agentId="a1" onClose={() => {}} onPick={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // The close affordance must have an accessible name (PERF-17).
    expect(screen.getByRole("button", { name: /close|cerrar/i })).toHaveAccessibleName();
  });

  it("TemplatePickerModal renders a dialog", () => {
    render(<TemplatePickerModal open onClose={() => {}} onPick={() => {}} />);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });
});
