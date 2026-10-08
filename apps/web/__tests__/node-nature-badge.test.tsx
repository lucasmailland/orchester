import { cleanup, render, screen } from "@testing-library/react";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import { afterEach, expect, it } from "vitest";
import { RegistryNode } from "@/components/flows/nodes/RegistryNode";

afterEach(cleanup);

function props(type: string, data: Record<string, unknown>): NodeProps {
  return {
    id: "n",
    type,
    data: { nodeId: type, label: type, ...data },
    selected: false,
    dragging: false,
    draggable: true,
    selectable: true,
    deletable: true,
    isConnectable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
}

const renderNode = (p: NodeProps) =>
  render(
    <ReactFlowProvider>
      <RegistryNode {...p} />
    </ReactFlowProvider>
  );

it("shows an AI badge on an agent node", () => {
  renderNode(props("agent", { nature: "ai", natureLabel: "AI step" }));
  expect(screen.getByTestId("nature-badge-ai")).toHaveAttribute("title", "AI step");
});

it("shows a human badge on a wait_human node", () => {
  renderNode(props("wait_human", { nature: "human", natureLabel: "Human step" }));
  expect(screen.getByTestId("nature-badge-human")).toBeInTheDocument();
});

it("shows nothing on an http node", () => {
  const { container } = renderNode(props("http", { nature: "code", natureLabel: "Code" }));
  expect(container.querySelector("[data-testid^='nature-badge']")).toBeNull();
});
