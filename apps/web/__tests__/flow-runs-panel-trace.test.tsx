import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import { FlowRunsPanel } from "@/components/flows/FlowRunsPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const base = {
  nodeType: "transform",
  status: "succeeded",
  output: null,
  error: null,
  startedAt: "2026-01-01T00:00:00Z",
  agentId: null,
  agentName: null,
  model: null,
  tokensUsed: null,
  costUsd: null,
};

async function openRun(steps: Array<Record<string, unknown>>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      json: async () =>
        url.includes("/api/flow-runs/")
          ? {
              run: { id: "r1", status: "succeeded", startedAt: "2026-01-01T00:00:00Z" },
              steps,
            }
          : [
              {
                id: "r1",
                status: "succeeded",
                startedAt: "2026-01-01T00:00:00Z",
                completedAt: null,
                triggerSource: "manual",
                error: null,
              },
            ],
    }))
  );
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{ pages: { flows: { runs: en.pages.flows.runs } } }}
    >
      <FlowRunsPanel flowId="f1" open onClose={() => {}} />
    </NextIntlClientProvider>
  );
  fireEvent.click(await screen.findByText("manual"));
  await screen.findByText("Steps");
}

it("shows the robot and the agent name when the step recorded an agent", async () => {
  await openRun([
    { ...base, id: "s1", nodeType: "agent", agentId: "a1", agentName: "Support writer" },
  ]);
  expect(await screen.findByText("Support writer")).toBeInTheDocument();
  expect(screen.getByLabelText("Agent")).toBeInTheDocument();
});

it("follows the data, not the node type: an agent node without a recorded agent has no robot", async () => {
  await openRun([{ ...base, id: "s1", nodeType: "agent" }]);
  expect(screen.queryByLabelText("Agent")).toBeNull();
});

it("shows the robot for a non-agent node that recorded an agent", async () => {
  await openRun([{ ...base, id: "s1", nodeType: "llm_prompt", agentName: "Triage" }]);
  expect(screen.getByLabelText("Agent")).toBeInTheDocument();
});

it("shows model, tokens and cost compactly, without a robot for a bare model step", async () => {
  await openRun([
    {
      ...base,
      id: "s1",
      nodeType: "llm_prompt",
      model: "claude-x",
      tokensUsed: 1234,
      costUsd: "0.012300",
    },
  ]);
  expect(screen.getByText(/claude-x/)).toBeInTheDocument();
  expect(screen.getByText(/1,234 tokens/)).toBeInTheDocument();
  expect(screen.getByText(/\$0\.0123/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Agent")).toBeNull();
});

it("renders a step without trace exactly as before", async () => {
  await openRun([{ ...base, id: "s1" }]);
  expect(screen.queryByLabelText("Agent")).toBeNull();
  expect(screen.queryByText(/tokens/)).toBeNull();
  expect(screen.queryByText(/\$/)).toBeNull();
});
