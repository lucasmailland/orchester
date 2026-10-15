import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIEW,
  MCP_VIEW,
  activityParams,
  formatDuration,
  formatTokens,
  formatUsd,
  isMcpView,
  rangeOf,
  toolLabel,
  type ActivityViewState,
} from "@/lib/activity/view";

const NOW = new Date("2026-03-10T12:00:00.000Z");

const view = (extra: Partial<ActivityViewState> = {}): ActivityViewState => ({
  ...DEFAULT_VIEW,
  ...extra,
});

describe("rangeOf", () => {
  it.each([
    ["24h", "2026-03-09T12:00:00.000Z"],
    ["7d", "2026-03-03T12:00:00.000Z"],
    ["30d", "2026-02-08T12:00:00.000Z"],
  ] as const)("ends now and starts %s earlier", (preset, from) => {
    const range = rangeOf(view({ preset }), NOW);
    expect(range?.from.toISOString()).toBe(from);
    expect(range?.to.toISOString()).toBe(NOW.toISOString());
  });

  it("reads a custom range from the date inputs", () => {
    const range = rangeOf(
      view({ preset: "custom", customFrom: "2026-03-01T08:00", customTo: "2026-03-02T09:30" }),
      NOW
    );
    expect(range?.from.getTime()).toBe(new Date("2026-03-01T08:00").getTime());
    expect(range?.to.getTime()).toBe(new Date("2026-03-02T09:30").getTime());
  });

  it("refuses a custom range that is incomplete, inverted or longer than 92 days", () => {
    expect(rangeOf(view({ preset: "custom", customFrom: "2026-03-01T08:00" }), NOW)).toBeNull();
    expect(
      rangeOf(
        view({ preset: "custom", customFrom: "2026-03-02T08:00", customTo: "2026-03-01T08:00" }),
        NOW
      )
    ).toBeNull();
    expect(
      rangeOf(
        view({ preset: "custom", customFrom: "2025-01-01T00:00", customTo: "2026-03-01T00:00" }),
        NOW
      )
    ).toBeNull();
  });
});

describe("activityParams", () => {
  it("sends only the range by default", () => {
    expect(activityParams(view(), NOW)?.toString()).toBe(
      "from=2026-03-03T12%3A00%3A00.000Z&to=2026-03-10T12%3A00%3A00.000Z"
    );
  });

  it("sends every filter that is set", () => {
    const params = activityParams(
      view({
        kinds: ["tool_call", "config_change"],
        agentId: "ag1",
        flowId: "fl1",
        integration: "id:int1",
        outcome: "error",
        ref: "  ticket:7 ",
      }),
      NOW
    )!;
    expect(params.get("kinds")).toBe("tool_call,config_change");
    expect(params.get("agentId")).toBe("ag1");
    expect(params.get("flowId")).toBe("fl1");
    expect(params.get("integrationId")).toBe("int1");
    expect(params.get("integrationType")).toBeNull();
    expect(params.get("outcome")).toBe("error");
    expect(params.get("ref")).toBe("ticket:7");
  });

  it("sends an integration type", () => {
    expect(activityParams(view({ integration: "type:mcp" }), NOW)?.get("integrationType")).toBe(
      "mcp"
    );
  });

  it("returns null when the range is not usable", () => {
    expect(activityParams(view({ preset: "custom" }), NOW)).toBeNull();
  });
});

describe("the MCP data access view", () => {
  it("is the default view narrowed to MCP integrations", () => {
    expect(MCP_VIEW).toEqual({ ...DEFAULT_VIEW, integration: "type:mcp" });
    expect(isMcpView(MCP_VIEW)).toBe(true);
    expect(isMcpView(DEFAULT_VIEW)).toBe(false);
    expect(activityParams(MCP_VIEW, NOW)?.get("integrationType")).toBe("mcp");
  });
});

describe("formatters", () => {
  it("formats dollars with the precision the amount needs", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(0.000123)).toBe("$0.0001");
    expect(formatUsd(0.0123)).toBe("$0.012");
    expect(formatUsd(12.345)).toBe("$12.35");
  });

  it("shortens token counts", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(1_250)).toBe("1.3K");
    expect(formatTokens(3_400_000)).toBe("3.4M");
  });

  it("formats durations", () => {
    expect(formatDuration(850)).toBe("850 ms");
    expect(formatDuration(12_340)).toBe("12.3 s");
    expect(formatDuration(245_000)).toBe("4m 05s");
    expect(formatDuration(7_380_000)).toBe("2h 03m");
  });
});

describe("toolLabel", () => {
  it("drops the mcp__<integration>__ prefix: the integration is shown apart", () => {
    expect(toolLabel("mcp__int1__find_people")).toBe("find_people");
    expect(toolLabel("mcp__a_b__c__d")).toBe("c__d");
  });

  it("leaves every other tool name as it is", () => {
    expect(toolLabel("odoo_get_case")).toBe("odoo_get_case");
    expect(toolLabel("odoo::post_note")).toBe("odoo::post_note");
    expect(toolLabel("mcp__")).toBe("mcp__");
    expect(toolLabel("mcp__nameonly")).toBe("mcp__nameonly");
  });
});
