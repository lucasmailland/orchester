import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../messages/en.json";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { DeleteFlowDialog } from "./DeleteFlowDialog";

const clean = {
  flow: { id: "flow_a", name: "Flow A" },
  counts: { runs: 12, versions: 4, webhooks: 2, schedules: 1 },
  blockers: { enabled: false, agents: [], flows: [] },
};

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function renderDialog(props: Partial<React.ComponentProps<typeof DeleteFlowDialog>> = {}) {
  const onClose = vi.fn();
  const onDeleted = vi.fn();
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{ pages: { flows: { builder: messages.pages.flows.builder } } }}
    >
      <DeleteFlowDialog
        open
        flowId="flow_a"
        flowName="Flow A"
        onClose={onClose}
        onDeleted={onDeleted}
        {...props}
      />
    </NextIntlClientProvider>
  );
  return { onClose, onDeleted };
}

describe("DeleteFlowDialog", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("states plainly what will be destroyed", async () => {
    fetchMock.mockReturnValue(json(clean));
    renderDialog();
    const text = await screen.findByText(/permanently deletes/i);
    expect(text.textContent).toContain("12 runs and their step history");
    expect(text.textContent).toContain("4 versions");
    expect(text.textContent).toContain("2 webhooks (their URLs will stop working)");
    expect(text.textContent).toContain("1 schedule");
    expect(fetchMock).toHaveBeenCalledWith("/api/flows/flow_a/delete-impact");
    expect(screen.getByRole("button", { name: /delete permanently/i })).toBeEnabled();
  });

  it("deletes, toasts and reports back on confirm", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === "DELETE" ? json({ ok: true }) : json(clean)
    );
    const { onDeleted } = renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: /delete permanently/i }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/flows/flow_a", { method: "DELETE" });
    expect(toast.success).toHaveBeenCalledWith("Flow deleted");
  });

  it("shows the server's reason and stays open when the delete is refused", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === "DELETE" ? json({ error: "nope, still enabled" }, 409) : json(clean)
    );
    const { onDeleted } = renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: /delete permanently/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("nope, still enabled"));
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("lists blockers and offers no confirm button when blocked", async () => {
    fetchMock.mockReturnValue(
      json({
        ...clean,
        blockers: {
          enabled: true,
          agents: [{ id: "agent_1", name: "Agent One" }],
          flows: [{ id: "flow_b", name: "Caller B" }],
        },
      })
    );
    renderDialog();
    expect(await screen.findByText(/pause it first/i)).toBeInTheDocument();
    expect(screen.getByText(/Agent One/)).toBeInTheDocument();
    expect(screen.getByText(/Caller B/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete permanently/i })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^close$/i }).length).toBeGreaterThan(0);
  });

  it("does not offer to delete when the impact could not be loaded", async () => {
    fetchMock.mockReturnValue(json({ error: "boom" }, 500));
    renderDialog();
    expect(await screen.findByText(/couldn't check/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete permanently/i })).toBeNull();
  });

  it("does not fetch while closed", () => {
    renderDialog({ open: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
