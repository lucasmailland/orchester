import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../messages/en.json";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { FlowKindPanel } from "./FlowKindPanel";

function renderPanel(props: Partial<React.ComponentProps<typeof FlowKindPanel>> = {}) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{ pages: { flows: { kind: messages.pages.flows.kind } } }}
    >
      <FlowKindPanel
        flowId="flow_a"
        kind="pipeline"
        externalCallers={[]}
        contractIssues={[]}
        onSaved={onSaved}
        onClose={onClose}
        {...props}
      />
    </NextIntlClientProvider>
  );
  return { onSaved, onClose };
}

describe("FlowKindPanel", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "flow_a" })));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("saves a new kind with PATCH", async () => {
    const { onSaved } = renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: /^action/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("action", []));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/flows/flow_a");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ kind: "action", externalCallers: [] });
  });

  it("edits the external callers list", async () => {
    const { onSaved } = renderPanel({ externalCallers: [{ name: "old" }] });
    fireEvent.click(screen.getByRole("button", { name: "Add caller" }));
    const names = screen.getAllByPlaceholderText(/^Name/);
    fireEvent.change(names[1]!, { target: { value: "nightly-script" } });
    fireEvent.change(screen.getAllByPlaceholderText(/^Note/)[1]!, { target: { value: "cron" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Remove caller" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith("pipeline", [{ name: "nightly-script", note: "cron" }])
    );
  });

  it("drops blank rows and caps the list at 10", () => {
    renderPanel({ externalCallers: Array.from({ length: 10 }, (_, i) => ({ name: `c${i}` })) });
    expect(screen.getByRole("button", { name: "Add caller" })).toBeDisabled();
  });

  it("shows the contract problems when the flow is an action", () => {
    renderPanel({ kind: "action", contractIssues: ['"Ask" uses an AI model'] });
    expect(screen.getByText(/does not meet the action contract/i)).toBeInTheDocument();
    expect(screen.getByText(/Ask/)).toBeInTheDocument();
  });

  it("does not warn for a pipeline", () => {
    renderPanel({ kind: "pipeline", contractIssues: ["x"] });
    expect(screen.queryByText(/action contract/i)).toBeNull();
  });

  it("surfaces a server error and does not report success", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "bad" }), { status: 400 }));
    const { onSaved } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("bad"));
    expect(onSaved).not.toHaveBeenCalled();
  });
});
