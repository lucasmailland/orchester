import { cleanup, render } from "@testing-library/react";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import { afterEach, expect, it } from "vitest";
import { ParallelNode } from "@/components/flows/nodes/BranchNode";

afterEach(cleanup);

it("puts the unnamed branch handle first so handle-less edges use it instead of done", () => {
  const props: NodeProps = {
    id: "p",
    type: "parallel",
    data: { label: "Parallel" },
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
  const { container } = render(
    <ReactFlowProvider>
      <ParallelNode {...props} />
    </ReactFlowProvider>
  );

  const handles = container.querySelectorAll(".react-flow__handle.source");
  expect(handles).toHaveLength(2);
  expect(handles[0]!.getAttribute("data-handleid") ?? "").toBe("");
  expect(handles[1]).toHaveAttribute("data-handleid", "done");
});
