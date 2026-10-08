import { describe, it, expect } from "vitest";
import { CONNECTORS, describedActionEffect } from "@/lib/integrations/registry";

const odooExecute = CONNECTORS.odoo!.actions.execute!;
const nrql = CONNECTORS.newrelic!.actions.nrql!;

describe("describedActionEffect", () => {
  it("trusts a fixed read even when the input is templated", () => {
    expect(
      describedActionEffect(nrql, { query: "SELECT count(*) FROM Log WHERE id = '{{id}}'" })
    ).toBe("read");
    expect(describedActionEffect({ effect: "read" }, { a: "{{x}}" })).toBe("read");
  });

  it("trusts a fixed write", () => {
    expect(describedActionEffect({ effect: "write" }, { a: "{{x}}" })).toBe("write");
  });

  it("execute with a literal read method is a read whatever the other inputs hold", () => {
    expect(
      describedActionEffect(odooExecute, {
        model: "res.partner",
        method: "search_read",
        args: [[["id", "=", "{{id}}"]]],
      })
    ).toBe("read");
  });

  it("execute with a templated method is unknown", () => {
    expect(describedActionEffect(odooExecute, { model: "m", method: "{{m}}", args: [] })).toBe(
      undefined
    );
  });

  it("execute with a literal write method is a write", () => {
    expect(
      describedActionEffect(odooExecute, { model: "m", method: "write", args: ["{{x}}"] })
    ).toBe("write");
  });

  it("an action that declares no keys keeps the whole-input rule", () => {
    const dyn = {
      effect: (i: Record<string, unknown>) =>
        i.a === "get" ? ("read" as const) : ("write" as const),
    };
    expect(describedActionEffect(dyn, { a: "get", b: "{{x}}" })).toBe(undefined);
    expect(describedActionEffect(dyn, { a: "get", b: "y" })).toBe("read");
    expect(describedActionEffect(dyn, { a: "set", b: "{{x}}" })).toBe("write");
  });

  it("an unresolved action is a write, never a guessed read", () => {
    expect(describedActionEffect(undefined, {})).toBe("write");
  });
});
