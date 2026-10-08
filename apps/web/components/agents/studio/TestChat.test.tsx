import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));

import { TestChat } from "./TestChat";

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
});
