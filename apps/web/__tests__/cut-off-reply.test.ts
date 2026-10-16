// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("@/lib/activity/tool-calls", () => ({ recordToolCall: h.record }));

import { refuseCutOffReply } from "@/lib/agents/cut-off-reply";
import { outputLimitRefusal } from "@/lib/ai/output-limit";

const calls = [
  { id: "t1", name: "odoo_get_task", input: { task_id: 7 } },
  { id: "t2", name: "odoo_post_task_note", input: { task_id: 7 } },
];
const info = { workspaceId: "ws_1", source: "flow_agent" as const, agentId: "agent_1" };

beforeEach(() => {
  h.record.mockReset().mockResolvedValue(undefined);
});

describe("refuseCutOffReply", () => {
  it("answers every call with the refusal, in order", async () => {
    expect(await refuseCutOffReply(calls, 1024, info)).toEqual([
      { id: "t1", name: "odoo_get_task", input: { task_id: 7 }, error: outputLimitRefusal(1024) },
      {
        id: "t2",
        name: "odoo_post_task_note",
        input: { task_id: 7 },
        error: outputLimitRefusal(1024),
      },
    ]);
  });

  it("logs every call, with the caller's attribution and the refusal as what it threw", async () => {
    await refuseCutOffReply(calls, null, info);
    expect(h.record).toHaveBeenCalledTimes(2);
    for (const [i, [entry]] of h.record.mock.calls.entries()) {
      expect(entry).toMatchObject({
        ...info,
        tool: calls[i]!.name,
        input: calls[i]!.input,
        durationMs: 0,
      });
      expect((entry.thrown as Error).message).toBe(outputLimitRefusal(null));
    }
  });
});
