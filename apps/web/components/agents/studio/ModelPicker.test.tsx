import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

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
