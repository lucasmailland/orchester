import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));

import { TestChat, simulatedHandoffTarget } from "./TestChat";

afterEach(() => vi.unstubAllGlobals());

describe("TestChat", () => {
  it("renders an assistant markdown list as a list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: "Steps:\n\n1. first\n2. **second**", tokensUsed: 3 }),
      })
    );
    const { container } = render(
      <TestChat agentId="a" systemPrompt="s" model="m" temperature={0} tools={["x"]} />
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "sendAria" }));
    await waitFor(() => expect(container.querySelectorAll("ol > li")).toHaveLength(2));
    expect(container.querySelector("strong")?.textContent).toBe("second");
  });

  it("renders a simulated handoff with its own label instead of the error badge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: "Elena would take over.",
          tokensUsed: 1,
          toolCalls: [
            {
              name: "agent_handoff",
              input: { agentId: "e", note: "n" },
              output: {
                simulated: true,
                wouldHandOffTo: { id: "e", name: "Elena", role: "HR" },
                note: "n",
              },
            },
          ],
        }),
      })
    );
    Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
    render(<TestChat agentId="a" systemPrompt="s" model="m" temperature={0} tools={["x"]} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "sendAria" }));
    await waitFor(() => expect(screen.getByText(/simulatedHandoff/)).toBeTruthy());
    expect(screen.queryByText("errorBadge")).toBeNull();
  });

  it("simulatedHandoffTarget only matches a simulated agent_handoff result", () => {
    const sim = { simulated: true, wouldHandOffTo: { name: "Elena" } };
    expect(simulatedHandoffTarget({ name: "agent_handoff", input: {}, output: sim })).toBe("Elena");
    expect(simulatedHandoffTarget({ name: "other", input: {}, output: sim })).toBeNull();
    expect(
      simulatedHandoffTarget({ name: "agent_handoff", input: {}, output: null, error: "boom" })
    ).toBeNull();
    expect(
      simulatedHandoffTarget({ name: "agent_handoff", input: {}, output: { ok: true } })
    ).toBeNull();
  });
});
