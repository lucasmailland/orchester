import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { NodeProps } from "@xyflow/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import {
  GroupActionsContext,
  GroupBlockNode,
  GroupFrameNode,
  type GroupActions,
} from "./GroupNode";
import type { GroupViewData } from "../group-view";

// Handles need a React Flow store; their behaviour is not what is under test.
vi.mock("@xyflow/react", () => ({
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
}));

const base: GroupViewData = {
  groupId: "g1",
  name: "Fetch monitoring data",
  description: "Reads the alert and its context",
  icon: "Globe",
  stepCount: 4,
  aiCount: 0,
  collapsed: true,
  issueCount: 0,
};

function renderNode(
  Component: typeof GroupBlockNode,
  data: Partial<GroupViewData> = {},
  actions?: GroupActions
) {
  const props = { id: "group:g1", data: { ...base, ...data } } as unknown as NodeProps;
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{ pages: { flows: { groups: messages.pages.flows.groups } } }}
    >
      <GroupActionsContext.Provider value={actions ?? null}>
        <Component {...props} />
      </GroupActionsContext.Provider>
    </NextIntlClientProvider>
  );
}

describe("collapsed group block", () => {
  it("shows name, description and step count, without an AI marker when there is no AI", () => {
    renderNode(GroupBlockNode);
    expect(screen.getByText("Fetch monitoring data")).toBeTruthy();
    expect(screen.getByText("Reads the alert and its context")).toBeTruthy();
    expect(screen.getByText("4 steps")).toBeTruthy();
    expect(screen.queryByTestId("group-ai-marker")).toBeNull();
  });

  it("marks AI steps inside", () => {
    renderNode(GroupBlockNode, { aiCount: 2 });
    expect(screen.getByTestId("group-ai-marker").textContent).toContain("2 AI steps");
  });

  it("says which step failed", () => {
    renderNode(GroupBlockNode, { status: "failed", failedStep: "Get the case" });
    expect(screen.getByTestId("group-status-failed").textContent).toBe("Failed at: Get the case");
  });

  it("counts problems inside", () => {
    renderNode(GroupBlockNode, { issueCount: 1 });
    expect(screen.getByText("1 problem inside")).toBeTruthy();
  });

  it("expands, edits and ungroups through the builder's actions", () => {
    const actions = { toggle: vi.fn(), edit: vi.fn(), ungroup: vi.fn() };
    renderNode(GroupBlockNode, {}, actions);
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Ungroup" }));
    expect(actions.toggle).toHaveBeenCalledWith("g1");
    expect(actions.edit).toHaveBeenCalledWith("g1");
    expect(actions.ungroup).toHaveBeenCalledWith("g1");
  });
});

describe("expanded group frame", () => {
  it("collapses through the builder's actions", () => {
    const actions = { toggle: vi.fn(), edit: vi.fn(), ungroup: vi.fn() };
    renderNode(GroupFrameNode, { collapsed: false }, actions);
    expect(screen.getByText("Fetch monitoring data")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(actions.toggle).toHaveBeenCalledWith("g1");
  });
});
