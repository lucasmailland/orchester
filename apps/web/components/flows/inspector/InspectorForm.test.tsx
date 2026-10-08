import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Node } from "@xyflow/react";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import pt from "../../../messages/pt.json";
import { InspectorForm } from "./InspectorForm";

vi.mock("@/components/ai/ModelPicker", () => ({ ModelPicker: () => null }));

const subflowNode = (config: Record<string, unknown>): Node => ({
  id: "s",
  type: "subflow",
  position: { x: 0, y: 0 },
  data: { nodeId: "subflow", label: "Call", config },
});

function setup(config: Record<string, unknown>, locale: "en" | "es" | "pt" = "en") {
  const messages = { en, es, pt }[locale];
  const onChange = vi.fn();
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={{ pages: { flows: { inspector: messages.pages.flows.inspector } } }}
    >
      <InspectorForm
        node={subflowNode(config)}
        locale={locale}
        onChange={onChange}
        onDelete={vi.fn()}
      />
    </NextIntlClientProvider>
  );
  return onChange;
}

const lastConfig = (fn: ReturnType<typeof vi.fn>) =>
  (fn.mock.calls.at(-1)![0] as Node).data.config as Record<string, unknown>;

describe("InspectorForm: subflow inputs/outputs", () => {
  it("shows both editors with translated label and help", () => {
    setup({ flowId: "x" });
    expect(screen.getByText("Data you pass in")).toBeTruthy();
    expect(screen.getByText("Data you get back")).toBeTruthy();
    expect(screen.getByText(/receives only these variables/)).toBeTruthy();
  });

  it("translates into every locale", () => {
    setup({ flowId: "x" }, "pt");
    expect(screen.getByText("Dados que você envia")).toBeTruthy();
  });

  it("has the same keys in every locale", () => {
    for (const m of [es, pt]) {
      expect(Object.keys(m.pages.flows.inspector.fields)).toEqual(
        Object.keys(en.pages.flows.inspector.fields)
      );
    }
  });

  it("adds an input entry and writes it to config.inputs", () => {
    const onChange = setup({ flowId: "x" });
    fireEvent.click(screen.getAllByText("+ Add")[0]!);
    expect(lastConfig(onChange).inputs).toEqual({ clave1: "" });
  });

  it("edits an existing output value", () => {
    const onChange = setup({ flowId: "x", outputs: { total: "a.b" } });
    fireEvent.change(screen.getByDisplayValue("a.b"), { target: { value: "a.c" } });
    expect(lastConfig(onChange).outputs).toEqual({ total: "a.c" });
  });

  it("drops the field when the last entry is removed", () => {
    const onChange = setup({ flowId: "x", inputs: { q: "{{m}}" } });
    fireEvent.click(screen.getByText("×"));
    expect(lastConfig(onChange).inputs).toBeUndefined();
  });
});
