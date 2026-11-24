/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import {
  AgentConfigPanel,
  type AgentConfigState,
} from "@/components/agents/studio/AgentConfigPanel";

const responses: Record<string, unknown> = {
  "/api/flows": [{ id: "flow_1", name: "Billing flow" }],
  "/api/knowledge-bases": [],
  "/api/tools": [],
  "/api/integrations": { catalog: [], configured: [{ id: "int_1", name: "CRM", type: "odoo" }] },
};

const state = (tools: string[]): AgentConfigState => ({
  kind: "conversational",
  flowId: null,
  variables: {},
  tools,
  knowledgeBaseIds: [],
  allowedIntegrationIds: [],
  allowedFlowIds: [],
  greeting: "",
  fallback: "",
  starters: [],
  avatarUrl: "",
  color: "#8b5cf6",
  maxTurns: 20,
  maxToolCalls: 5,
  responseFormat: "text",
  outputSchema: "",
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({ ok: true, json: async () => responses[url] ?? [] }))
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AgentConfigPanel integration and flow scope (EXEC-005)", () => {
  it("lets the user pick integrations and flows when the agent has the tools", async () => {
    const onChange = vi.fn();
    render(
      <AgentConfigPanel value={state(["run_integration", "flow_call"])} onChange={onChange} />
    );
    fireEvent.click(await screen.findByRole("button", { name: "CRM (odoo)" }));
    expect(onChange).toHaveBeenCalledWith({ allowedIntegrationIds: ["int_1"] });
    fireEvent.click(await screen.findByRole("button", { name: "Billing flow" }));
    expect(onChange).toHaveBeenCalledWith({ allowedFlowIds: ["flow_1"] });
  });

  it("hides both pickers when the agent has neither tool", async () => {
    render(<AgentConfigPanel value={state([])} onChange={vi.fn()} />);
    await screen.findByText("kbEmpty");
    expect(screen.queryByText("integrationScopeTitle")).toBeNull();
    expect(screen.queryByText("flowScopeTitle")).toBeNull();
  });
});
