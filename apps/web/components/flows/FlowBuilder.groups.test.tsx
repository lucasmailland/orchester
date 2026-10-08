import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../messages/en.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({ locale: "en", workspaceSlug: "ws" }),
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { FlowBuilder, type FlowDTO } from "./FlowBuilder";

// React Flow keeps nodes `visibility: hidden` until it has measured them, which
// never happens in jsdom, and hidden elements have no accessible name for role
// queries. The node buttons are found by their aria-label instead.
const byRole = (name: string) => screen.findByLabelText(name);

// React Flow measures nodes with ResizeObserver and DOMMatrix, which jsdom lacks.
// Set on the global object directly: `unstubAllGlobals` after each test only
// undoes the `fetch` stub.
beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  class Matrix {
    m22 = 1;
  }
  Object.assign(globalThis, { ResizeObserver: RO, DOMMatrixReadOnly: Matrix });
});

const step = (id: string, type: string, x: number, config: Record<string, unknown> = {}) => ({
  id,
  type,
  label: `Step ${id}`,
  config,
  position: { x, y: 100 },
});

const flow: FlowDTO = {
  id: "flow_a",
  name: "Grouped",
  nodes: [
    step("t", "trigger", 0, { triggerKind: "manual" }),
    step("a", "http", 300, { url: "https://example.com/a" }),
    step("b", "llm_prompt", 600, { prompt: "hi" }),
    step("c", "transform", 900, { template: "{}" }),
  ],
  edges: [
    { id: "e1", source: "t", target: "a" },
    { id: "e2", source: "a", target: "b" },
    { id: "e3", source: "b", target: "c" },
  ],
  variables: {},
  spec: "## Purpose",
  groups: [
    {
      id: "g1",
      name: "Fetch and ask",
      description: "Gets data",
      icon: "Globe",
      nodeIds: ["a", "b"],
    },
  ],
};

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderBuilder(f: FlowDTO = flow) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FlowBuilder flow={f} />
    </NextIntlClientProvider>
  );
}

describe("FlowBuilder with step groups", () => {
  it("draws a stored group collapsed, as one block in place of its steps", async () => {
    renderBuilder();
    const block = await screen.findByTestId("flow-group-block");
    expect(block.textContent).toContain("Fetch and ask");
    expect(block.textContent).toContain("2 steps");
    expect(screen.getByTestId("group-ai-marker")).toBeTruthy();
    expect(screen.queryByText("Step a")).toBeNull();
    expect(screen.queryByText("Step b")).toBeNull();
    expect(screen.getByText("Step c")).toBeTruthy();
  });

  it("expands to show the steps inside a frame, and collapses again", async () => {
    renderBuilder();
    fireEvent.click(await byRole("Expand"));
    expect(await screen.findByTestId("flow-group-frame")).toBeTruthy();
    expect(screen.getByText("Step a")).toBeTruthy();
    fireEvent.click(await byRole("Collapse"));
    await waitFor(() => expect(screen.queryByText("Step a")).toBeNull());
  });

  it("collapsing a group drops the selection of the steps it hides", async () => {
    const { container } = renderBuilder();
    fireEvent.click(await byRole("Expand"));
    await waitFor(() => expect(container.querySelector('[data-id="a"]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-id="a"]') as HTMLElement);
    await waitFor(() =>
      expect(screen.getByTestId("extract-selection").getAttribute("title")).not.toMatch(
        /Choose the steps/
      )
    );
    fireEvent.click(await byRole("Collapse"));
    await waitFor(() =>
      expect(screen.getByTestId("extract-selection").getAttribute("title")).toMatch(
        /Choose the steps/
      )
    );
  });

  it("ungrouping keeps the steps and saves a flow without the group", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderBuilder();
      fireEvent.click(await byRole("Ungroup"));
      expect(await screen.findByText("Step a")).toBeTruthy();
      expect(screen.queryByTestId("flow-group-block")).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });
      const patch = fetchMock.mock.calls.find(
        ([url, init]) => url === "/api/flows/flow_a" && init?.method === "PATCH"
      );
      expect(patch).toBeDefined();
      const body = JSON.parse(patch![1].body as string);
      expect(body.groups).toEqual([]);
      expect(body.nodes.map((n: { id: string }) => n.id)).toEqual(["t", "a", "b", "c"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not save anything just for opening a grouped flow", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderBuilder();
      await screen.findByTestId("flow-group-block");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("groups two selected steps from the toolbar, collapsed by default", async () => {
    const { container } = renderBuilder({ ...flow, groups: [] });
    const nodeEl = async (id: string) => {
      await waitFor(() => expect(container.querySelector(`[data-id="${id}"]`)).not.toBeNull());
      return container.querySelector(`[data-id="${id}"]`) as HTMLElement;
    };
    fireEvent.click(await nodeEl("b"));
    // Hold React Flow's multi-selection key (Meta on macOS, Control elsewhere).
    const key = navigator.userAgent.includes("Mac") ? "Meta" : "Control";
    fireEvent.keyDown(window, { key, code: key });
    fireEvent.click(await nodeEl("c"));
    fireEvent.keyUp(window, { key, code: key });
    const button = await screen.findByTestId("group-steps");
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    fireEvent.click(button);
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Ask and shape" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Group" }));
    const block = await screen.findByTestId("flow-group-block");
    expect(block.textContent).toContain("Ask and shape");
    expect(block.textContent).toContain("2 steps");
    expect(screen.queryByText("Step c")).toBeNull();
  });

  it("shows a failure inside a collapsed group on the block, and expanding reveals the step", async () => {
    const events = [
      { type: "run_start", runId: "r1" },
      { type: "step_start", nodeId: "t", nodeType: "trigger" },
      { type: "step_finish", nodeId: "t", status: "succeeded" },
      { type: "step_start", nodeId: "a", nodeType: "http" },
      { type: "step_finish", nodeId: "a", status: "succeeded" },
      { type: "step_start", nodeId: "b", nodeType: "llm_prompt" },
      { type: "step_finish", nodeId: "b", status: "failed", error: "model refused" },
      { type: "run_finish", status: "failed", error: "model refused" },
    ];
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith("/run-stream")
        ? new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""))
        : new Response("[]")
    );
    const { container } = renderBuilder();
    await screen.findByTestId("flow-group-block");
    fireEvent.click(screen.getAllByRole("button", { name: "Run" })[0]!);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Run" }));
    const failed = await screen.findByTestId("group-status-failed");
    expect(failed.textContent).toBe("Failed at: Step b");
    // The run log names the group too.
    expect(await screen.findByText("Fetch and ask › Step b")).toBeTruthy();
    fireEvent.click(await byRole("Expand"));
    await waitFor(() =>
      expect(container.querySelector('[data-id="b"]')?.className).toContain("flow-node-fail")
    );
    expect(container.querySelector('[data-id="a"]')?.className).toContain("flow-node-ok");
  });

  it("extracts a group into a new flow and shows the step that calls it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const parentAfter = {
        id: "flow_a",
        nodes: [
          flow.nodes[0],
          {
            id: "sub_1",
            type: "subflow",
            label: "Fetch and ask",
            config: { flowId: "flow_new", inputs: {}, outputs: {}, icon: "Globe" },
            position: { x: 300, y: 100 },
          },
          flow.nodes[3],
        ],
        edges: [
          { id: "e1", source: "t", target: "sub_1" },
          { id: "e3", source: "sub_1", target: "c" },
        ],
        groups: [],
      };
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
        url === "/api/flows/flow_a/extract" && init?.method === "POST"
          ? new Response(
              JSON.stringify({
                plan: {},
                child: { id: "flow_new", name: "Fetch and ask", kind: "pipeline", enabled: true },
                parent: parentAfter,
              }),
              { status: 201 }
            )
          : new Response("[]")
      );
      renderBuilder();
      const block = await screen.findByTestId("flow-group-block");
      fireEvent.click(within(block).getByLabelText("Extract to flow"));
      const dialog = await screen.findByRole("dialog");
      // The AI step makes it a pipeline, and the preview says why.
      expect(within(dialog).getByTestId("extract-kind").textContent).toContain('"Step b" uses AI');
      fireEvent.click(within(dialog).getByRole("button", { name: "Create flow" }));
      expect(await screen.findByText("Fetch and ask")).toBeTruthy();
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      const post = fetchMock.mock.calls.find(([url]) => url === "/api/flows/flow_a/extract")!;
      expect(JSON.parse(post[1].body as string)).toEqual({
        groupId: "g1",
        name: "Fetch and ask",
        description: "Gets data",
        icon: "Globe",
      });
      expect(screen.queryByTestId("flow-group-block")).toBeNull();
      expect(toast.success).toHaveBeenCalledWith(
        'Created the flow "Fetch and ask".',
        expect.objectContaining({ action: expect.anything() })
      );
      // The server already stored this graph: nothing is saved back.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("disables extraction of a group that cannot move, saying why", async () => {
    // A group at the end of the flow: no connection leaves it.
    renderBuilder({
      ...flow,
      groups: [{ id: "g2", name: "Tail", nodeIds: ["b", "c"] }],
    });
    const block = await screen.findByTestId("flow-group-block");
    const button = within(block).getByLabelText("Extract to flow");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("title")).toContain("there are 0");
  });

  it("refuses to group fewer than two steps, saying why", async () => {
    renderBuilder({ ...flow, groups: [] });
    const button = await screen.findByTestId("group-steps");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("title")).toMatch(/at least two steps/);
    fireEvent.keyDown(window, { key: "g", metaKey: true });
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/at least two steps/));
  });
});
