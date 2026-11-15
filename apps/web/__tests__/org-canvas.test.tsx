/**
 * PERF-2 — OrgCanvas loading/error/empty states.
 * Covers the three branches added to the render tree so regressions are caught
 * without wiring up the full ReactFlow + auth stack.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { OrgCanvas } from "../components/org/OrgCanvas";

// ---------- heavy dependency stubs ----------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ locale: "es", workspaceSlug: "ws-test" }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "dark" }),
}));

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="reactflow">{children}</div>
  ),
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  Handle: () => null,
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
  applyNodeChanges: (_changes: unknown[], nodes: unknown[]) => nodes,
  useReactFlow: () => ({ fitView: vi.fn() }),
}));

vi.mock("@heroui/react", () => ({
  Spinner: ({ size }: { size?: string }) => <div data-testid="spinner" data-size={size} />,
}));

// ---------- fetch helpers ----------

function mockFetch(impl: () => Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(impl);
}

function pendingFetch() {
  return mockFetch(() => new Promise(() => {})); // never resolves
}

function failingFetch() {
  return mockFetch(() => Promise.reject(new Error("network error")));
}

function successFetch(data: object) {
  return mockFetch(() => Promise.resolve(new Response(JSON.stringify(data), { status: 200 })));
}

// ---------- tests ----------

describe("OrgCanvas", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows loading spinner while fetch is pending", () => {
    pendingFetch();
    render(<OrgCanvas />);
    expect(screen.getByTestId("spinner")).toBeDefined();
    expect(screen.queryByTestId("org-error")).toBeNull();
    expect(screen.queryByTestId("reactflow")).toBeNull();
  });

  it("shows error state when fetch fails", async () => {
    failingFetch();
    render(<OrgCanvas />);
    await waitFor(() => expect(screen.queryByTestId("spinner")).toBeNull());
    expect(screen.getByTestId("org-error")).toBeDefined();
  });

  it("shows empty state when fetch returns no nodes", async () => {
    successFetch({ nodes: [], edges: [] });
    render(<OrgCanvas />);
    // "empty" key is rendered via t("empty")
    await waitFor(() => expect(screen.getByText("empty")).toBeDefined());
    expect(screen.queryByTestId("org-error")).toBeNull();
  });

  it("renders ReactFlow when data has nodes", async () => {
    successFetch({
      nodes: [{ id: "workspace:w1", type: "workspace", label: "Orchester" }],
      edges: [],
    });
    render(<OrgCanvas />);
    await waitFor(() => expect(screen.getByTestId("reactflow")).toBeDefined());
    expect(screen.queryByTestId("org-error")).toBeNull();
  });
});
