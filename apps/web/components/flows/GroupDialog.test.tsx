import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../messages/en.json";
import { GroupDialog, type GroupMeta } from "./GroupDialog";

function renderDialog(props: Partial<React.ComponentProps<typeof GroupDialog>> = {}) {
  const onSubmit = vi.fn<(meta: GroupMeta) => void>();
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{ pages: { flows: { groups: messages.pages.flows.groups } } }}
    >
      <GroupDialog mode="create" stepCount={3} onSubmit={onSubmit} onClose={onClose} {...props} />
    </NextIntlClientProvider>
  );
  return { onSubmit, onClose };
}

describe("GroupDialog", () => {
  it("requires a name", () => {
    const { onSubmit } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Group" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Give the group a name.");
  });

  it("submits the name, a one-line description and the chosen icon", () => {
    const { onSubmit } = renderDialog();
    expect(screen.getByText("3 steps selected")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Fetch data  " } });
    fireEvent.change(screen.getByLabelText("Description (one line)"), {
      target: { value: "  Reads the alert and its context " },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Globe" }));
    fireEvent.click(screen.getByRole("button", { name: "Group" }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Fetch data",
      description: "Reads the alert and its context",
      icon: "Globe",
    });
  });

  it("omits an empty description and no icon", () => {
    const { onSubmit } = renderDialog();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Write the note" } });
    fireEvent.click(screen.getByRole("button", { name: "Group" }));
    expect(onSubmit).toHaveBeenCalledWith({ name: "Write the note" });
  });

  it("edits an existing group, starting from its values", () => {
    const { onSubmit } = renderDialog({
      mode: "edit",
      initial: { name: "Old", description: "d", icon: "Bell" },
    });
    expect(screen.getByText("Edit group")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Bell" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New" } });
    fireEvent.click(screen.getByRole("radio", { name: "No icon" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith({ name: "New", description: "d" });
  });

  it("closes without submitting", () => {
    const { onSubmit, onClose } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
