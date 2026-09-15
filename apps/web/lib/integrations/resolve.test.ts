import { describe, it, expect } from "vitest";
import { resolveIntegrationRef } from "./resolve";

const rows = [
  { id: "int_odoo", type: "odoo", enabled: true },
  { id: "int_resend", type: "resend", enabled: true },
  { id: "int_slack_a", type: "slack", enabled: true },
  { id: "int_slack_b", type: "slack", enabled: true },
  { id: "int_notion", type: "notion", enabled: false },
];

// The editor stores "<row id>::<action>", but a template cannot know a
// workspace's row ids — so a template names the connector type instead, and
// that used to fail as "Integración no encontrada".
describe("resolveIntegrationRef", () => {
  it("prefers an exact row id, which is what the editor stores", () => {
    expect(resolveIntegrationRef(rows, "int_resend")).toEqual({ ok: true, id: "int_resend" });
  });

  it("resolves a connector type to the only enabled integration of that type", () => {
    expect(resolveIntegrationRef(rows, "odoo")).toEqual({ ok: true, id: "int_odoo" });
  });

  it("refuses to guess between several integrations of the same type", () => {
    expect(resolveIntegrationRef(rows, "slack")).toEqual({
      ok: false,
      reason: "ambiguous",
      count: 2,
    });
  });

  it("reports a type that is only present disabled", () => {
    expect(resolveIntegrationRef(rows, "notion")).toEqual({
      ok: false,
      reason: "disabled",
      count: 1,
    });
  });

  it("reports when nothing matches", () => {
    expect(resolveIntegrationRef(rows, "stripe")).toEqual({
      ok: false,
      reason: "not_found",
      count: 0,
    });
  });

  it("returns an exact id even when that row is disabled, so the caller can say so", () => {
    expect(resolveIntegrationRef(rows, "int_notion")).toEqual({ ok: true, id: "int_notion" });
  });
});
