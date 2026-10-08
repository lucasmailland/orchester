import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import pt from "../../messages/pt.json";
import { ExtractDialog } from "./ExtractDialog";
import type { ExtractionBlockCode, ExtractionPlan, ExtractionResult } from "@/lib/flows/extract";

const plan: ExtractionPlan = {
  nodeIds: ["b", "c"],
  entryEdgeId: "a-b",
  exitEdgeId: "c-d",
  entryNodeId: "b",
  exitNodeId: "c",
  inputs: ["ticket", "ticketId"],
  inputsUnknown: [],
  outputs: ["summary"],
  outputsUnknown: [],
  staysInside: ["scratch"],
  staysInsideUnknown: [],
  kind: "action",
  kindReasons: [],
  movedGroupIds: [],
  sourceGroupId: "g1",
  notes: ["created_enabled", "error_prefix"],
};
const labels: Record<string, string> = { b: "Read priority", c: "Write summary", d: "Post note" };
const labelOf = (id: string) => labels[id] ?? id;

function renderDialog(
  result: ExtractionResult,
  onConfirm = vi.fn(async (): Promise<string | null> => null)
) {
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{
        pages: { flows: { extract: en.pages.flows.extract, groups: en.pages.flows.groups } },
      }}
    >
      <ExtractDialog
        result={result}
        initial={{ name: "Enrich", description: "Adds priority", icon: "Wand2" }}
        labelOf={labelOf}
        onConfirm={onConfirm}
        onClose={onClose}
      />
    </NextIntlClientProvider>
  );
  return { onConfirm, onClose };
}

describe("ExtractDialog", () => {
  it("previews the steps that move, inputs, outputs, what stays inside and the kind", () => {
    renderDialog({ ok: true, plan });
    const preview = screen.getByTestId("extract-preview");
    expect(preview.textContent).toContain("Read priority");
    expect(preview.textContent).toContain("Write summary");
    for (const v of ["ticket", "ticketId", "summary", "scratch"]) {
      expect(screen.getByText(v)).toBeTruthy();
    }
    expect(screen.getByTestId("extract-kind").textContent).toMatch(/^Action/);
    expect(preview.textContent).toContain("created enabled");
  });

  it("says why the new flow is a pipeline", () => {
    renderDialog({
      ok: true,
      plan: { ...plan, kind: "pipeline", kindReasons: [{ code: "ai", nodeId: "b", label: "b" }] },
    });
    expect(screen.getByTestId("extract-kind").textContent).toContain('"Read priority" uses AI');
  });

  it("says when every variable goes in or comes back", () => {
    renderDialog({
      ok: true,
      plan: {
        ...plan,
        inputs: null,
        inputsUnknown: [{ nodeId: "c", reason: "javascript" }],
        outputs: null,
      },
    });
    expect(screen.getByText(/Every variable of this flow, because "Write summary"/)).toBeTruthy();
    expect(screen.getByText(/Everything the new flow ends with/)).toBeTruthy();
  });

  it("confirms with the name, description and icon", async () => {
    const { onConfirm } = renderDialog({ ok: true, plan });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Enrich ticket" } });
    fireEvent.click(screen.getByRole("button", { name: "Create flow" }));
    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith({
        name: "Enrich ticket",
        description: "Adds priority",
        icon: "Wand2",
      })
    );
  });

  it("shows the server's error and stays open", async () => {
    renderDialog(
      { ok: true, plan },
      vi.fn(async () => "Couldn't extract the steps: quota")
    );
    fireEvent.click(screen.getByRole("button", { name: "Create flow" }));
    expect((await screen.findByRole("alert")).textContent).toContain("quota");
  });

  it("explains why the steps cannot move and offers nothing to confirm", () => {
    renderDialog({
      ok: false,
      blocks: [
        { code: "exits", count: 2 },
        { code: "fan_out", nodeId: "b" },
      ],
    });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(
      "Exactly one connection must leave the steps; there are 2."
    );
    expect(alert.textContent).toContain('"Read priority" continues on several paths at once.');
    expect(screen.getByRole("button", { name: "Create flow" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("refusal messages", () => {
  // A Record so tsc fails when a refusal code is added without being listed here.
  const all: Record<ExtractionBlockCode, true> = {
    parent_is_action: true,
    empty: true,
    unknown_group: true,
    unknown_step: true,
    trigger_inside: true,
    wait_human_inside: true,
    group_split: true,
    entries: true,
    exits: true,
    cycle: true,
    branch_ends: true,
    fan_out: true,
    exit_on_branch: true,
    exit_in_branch: true,
    unreachable: true,
  };
  const codes = Object.keys(all);
  it.each([
    ["en", en],
    ["es", es],
    ["pt", pt],
  ])("exist for every refusal in %s", (_locale, messages) => {
    const extract = messages.pages.flows.extract as Record<string, string>;
    for (const code of codes) expect(extract[`block_${code}`], code).toBeTruthy();
  });
});
