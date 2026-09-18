import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import { ModelPicker } from "./ModelPicker";

const catalog = {
  models: [
    {
      id: "bedrock:us.anthropic.claude-opus-4-7",
      name: "Claude Opus 4.7 (Bedrock)",
      provider: "bedrock",
      tier: "powerful",
      ctx: 200000,
    },
    {
      id: "bedrock:us.anthropic.claude-sonnet-4-6",
      name: "Claude Sonnet 4.6 (Bedrock)",
      provider: "bedrock",
      tier: "smart",
      ctx: 200000,
    },
  ],
  providers: [{ id: "bedrock", name: "Amazon Bedrock" }],
};

describe("ModelPicker", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ json: async () => catalog }))
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("swaps an unavailable model for its equivalent on a connected provider", async () => {
    // Templates and the create modal preload "claude-sonnet-4-6", which only
    // the anthropic provider serves. With Bedrock connected, the agent was
    // created and then failed with "Provider anthropic not configured".
    const onChange = vi.fn();
    render(<ModelPicker value="claude-sonnet-4-6" onChange={onChange} fallbackToAvailable />);
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("bedrock:us.anthropic.claude-sonnet-4-6")
    );
  });

  it("falls back to the first available model when there is no equivalent", async () => {
    const onChange = vi.fn();
    render(<ModelPicker value="gpt-5" onChange={onChange} fallbackToAvailable />);
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("bedrock:us.anthropic.claude-opus-4-7")
    );
  });

  it("leaves an available model alone", async () => {
    const onChange = vi.fn();
    render(
      <ModelPicker
        value="bedrock:us.anthropic.claude-sonnet-4-6"
        onChange={onChange}
        fallbackToAvailable
      />
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(onChange).not.toHaveBeenCalled();
  });

  describe("where the list opens", () => {
    /** Put the trigger at `top` in a window `height` tall, then open the list. */
    async function openAt(top: number, height = 800) {
      vi.stubGlobal("innerHeight", height);
      const view = render(<ModelPicker value="" onChange={vi.fn()} />);
      const trigger = await view.findByRole("button", { name: /pickModel/ });
      vi.spyOn(trigger.parentElement!, "getBoundingClientRect").mockReturnValue({
        top,
        bottom: top + 40,
        left: 0,
        right: 200,
        width: 200,
        height: 40,
        x: 0,
        y: top,
        toJSON: () => ({}),
      });
      fireEvent.click(trigger);
      return view.getByRole("listbox");
    }

    it("drops downwards when there is room below", async () => {
      const list = await openAt(100);
      expect(list.className).toContain("mt-1.5");
      expect(list.className).not.toContain("bottom-full");
    });

    it("opens upwards when the trigger sits near the bottom of the window", async () => {
      // This is the reported bug: at the bottom of a panel the options ran off
      // the screen and the only way to read them was to scroll the page.
      const list = await openAt(700);
      expect(list.className).toContain("bottom-full");
    });

    it("is capped by the default height when there is plenty of room", async () => {
      // 800 - (600 + 40) - 12 = 148 below against 588 above, so it flips, and
      // the height comes from the cap rather than from the space.
      const list = await openAt(600);
      expect(list.className).toContain("bottom-full");
      expect(list.style.maxHeight).toBe("288px");
    });

    it("still shows a usable list when the window is cramped both ways", async () => {
      const list = await openAt(180, 360);
      expect(Number.parseInt(list.style.maxHeight, 10)).toBeGreaterThanOrEqual(160);
    });

    it("closes on Escape and on a click outside", async () => {
      const list = await openAt(100);
      expect(list).toBeTruthy();
      fireEvent.keyDown(window, { key: "Escape" });
      await waitFor(() => expect(document.querySelector("[role=listbox]")).toBeNull());
    });
  });

  it("never changes the model unless asked to", async () => {
    // The agent editor shows an existing agent's model. Swapping it silently
    // there would change a working configuration on the next save.
    const onChange = vi.fn();
    render(<ModelPicker value="claude-sonnet-4-6" onChange={onChange} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(onChange).not.toHaveBeenCalled();
  });
});
