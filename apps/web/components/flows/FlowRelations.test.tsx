import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import messages from "../../messages/en.json";
import type { FlowRelations } from "@/lib/flows/relations";

vi.mock("next/navigation", () => ({
  useParams: () => ({ locale: "en", workspaceSlug: "acme" }),
}));

import { FlowRelationChips, FlowRelationsSection } from "./FlowRelations";

const link = (over: Partial<FlowRelations["uses"][number]> = {}) => ({
  flowId: "f1",
  name: "Parent",
  kind: "pipeline" as const,
  ai: false,
  missing: false,
  steps: ["Call it"],
  ...over,
});
const rel = (over: Partial<FlowRelations> = {}): FlowRelations => ({
  usedBy: [],
  uses: [],
  externalCallers: [],
  webhooks: 0,
  schedules: 0,
  ...over,
});

function ui(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages as unknown as AbstractIntlMessages}>
      {node}
    </NextIntlClientProvider>
  );
}

describe("FlowRelationChips", () => {
  it("renders nothing when there are no relations", () => {
    ui(<FlowRelationChips relations={rel()} />);
    expect(screen.queryByTestId("flow-relations")).toBeNull();
  });

  it("hides the chip of a side with zero", () => {
    ui(<FlowRelationChips relations={rel({ uses: [link()] })} />);
    expect(screen.getByRole("button", { name: /uses 1/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /used by/i })).toBeNull();
  });

  it("counts callers, external callers and triggers under Used by", () => {
    ui(
      <FlowRelationChips
        relations={rel({
          usedBy: [link()],
          externalCallers: [{ name: "nightly script", note: "cron box" }],
          webhooks: 2,
          schedules: 1,
        })}
      />
    );
    expect(screen.getByRole("button", { name: /used by 5/i })).toBeTruthy();
  });

  it("opens a dialog with links, kind, AI marker, externals and triggers", () => {
    ui(
      <FlowRelationChips
        relations={rel({
          usedBy: [link({ flowId: "p9", name: "Parent", kind: "action", ai: true })],
          externalCallers: [{ name: "nightly script", note: "cron box" }],
          webhooks: 2,
          schedules: 1,
        })}
      />
    );
    const chip = screen.getByRole("button", { name: /used by 5/i });
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    const dialog = screen.getByRole("dialog", { name: "Used by" });
    const a = within(dialog).getByRole("link", { name: "Parent" });
    expect(a.getAttribute("href")).toBe("/en/acme/flows/p9");
    expect(within(dialog).getByText("Action")).toBeTruthy();
    expect(within(dialog).getByText("AI")).toBeTruthy();
    expect(within(dialog).getByText("nightly script")).toBeTruthy();
    expect(within(dialog).getByText(/cron box/)).toBeTruthy();
    expect(within(dialog).getByText("2 enabled webhooks")).toBeTruthy();
    expect(within(dialog).getByText("1 enabled schedule")).toBeTruthy();
    expect(within(dialog).getByText("via Call it")).toBeTruthy();
  });

  it("flags a missing flow in Uses", () => {
    ui(
      <FlowRelationChips
        relations={rel({ uses: [link({ missing: true, name: null, kind: null })] })}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /uses 1/i }));
    expect(screen.getByText("Missing flow")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("closes on Escape, returning focus, and on outside click", () => {
    ui(
      <div>
        <button>outside</button>
        <FlowRelationChips relations={rel({ uses: [link()] })} />
      </div>
    );
    const chip = screen.getByRole("button", { name: /uses 1/i });
    fireEvent.click(chip);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("link"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(chip);

    fireEvent.click(chip);
    fireEvent.mouseDown(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("toggles on a second click and opens one side at a time", () => {
    ui(<FlowRelationChips relations={rel({ usedBy: [link()], uses: [link({ flowId: "c" })] })} />);
    const by = screen.getByRole("button", { name: /used by 1/i });
    const uses = screen.getByRole("button", { name: /uses 1/i });
    fireEvent.click(by);
    fireEvent.click(uses);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(by.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(uses);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("FlowRelationsSection", () => {
  it("shows both sides with empty hints", () => {
    ui(<FlowRelationsSection relations={rel()} />);
    expect(screen.getByText("Nothing calls or starts this flow.")).toBeTruthy();
    expect(screen.getByText("This flow calls no other flows.")).toBeTruthy();
  });
});
