import { describe, it, expect } from "vitest";
import { validateStoredFlow, hasErrors } from "./validate-stored";

const trigger = {
  id: "t",
  type: "trigger",
  label: "Start",
  config: { triggerKind: "manual" },
  position: { x: 0, y: 0 },
  purpose: "Start by hand",
};
const transform = (id: string, template: unknown, purpose = "Shape data") => ({
  id,
  type: "transform",
  label: id,
  config: { template },
  position: { x: 0, y: 0 },
  purpose,
});

describe("validateStoredFlow", () => {
  it("validates flat stored nodes like the editor does", () => {
    const missing = {
      id: "a",
      type: "agent",
      label: "A",
      config: {},
      position: { x: 0, y: 0 },
      purpose: "Answer",
    };
    const issues = validateStoredFlow([trigger, missing], [{ id: "e", source: "t", target: "a" }], {
      spec: "x",
    });
    expect(issues.some((i) => i.level === "error" && i.nodeId === "a")).toBe(true);
  });
  it("rejects unknown raw types before normalization hides them", () => {
    const issues = validateStoredFlow([trigger, { id: "z", type: "teleport", config: {} }], [], {
      spec: "x",
    });
    expect(hasErrors(issues)).toBe(true);
    expect(issues.find((i) => i.nodeId === "z")?.message).toMatch(/teleport/);
  });
  it("accepts legacy types that have an equivalent", () => {
    const issues = validateStoredFlow([trigger, { id: "b", type: "branch", config: {} }], [], {
      spec: "x",
    });
    expect(issues.some((i) => i.nodeId === "b" && /teleport|desconocido/.test(i.message))).toBe(
      false
    );
  });
  it("reports bad filters in any config string as errors", () => {
    const issues = validateStoredFlow(
      [trigger, transform("x", { a: "{{b | nope}}" })],
      [{ id: "e", source: "t", target: "x" }],
      {
        spec: "x",
      }
    );
    expect(
      issues.some((i) => i.level === "error" && i.nodeId === "x" && /nope/.test(i.message))
    ).toBe(true);
  });
  it("allows done edges only from try_catch, parallel and loop_for_each", () => {
    const bad = validateStoredFlow(
      [trigger, transform("x", "{}"), transform("y", "{}")],
      [
        { id: "e1", source: "t", target: "x" },
        { id: "e2", source: "x", target: "y", sourceHandle: "done" },
      ],
      { spec: "x" }
    );
    expect(bad.some((i) => i.level === "error" && /done/.test(i.message))).toBe(true);
    const ok = validateStoredFlow(
      [
        trigger,
        {
          id: "tc",
          type: "try_catch",
          label: "tc",
          config: {},
          position: { x: 0, y: 0 },
          purpose: "p",
        },
        transform("y", "{}"),
      ],
      [
        { id: "e1", source: "t", target: "tc" },
        { id: "e2", source: "tc", target: "y", sourceHandle: "done" },
      ],
      { spec: "x" }
    );
    expect(ok.some((i) => /done/.test(i.message))).toBe(false);
  });
  it("rejects a try_catch with no try branch, which only fails when it runs", () => {
    // Esto pasó de verdad: el flow validó sin un solo error y reventó en la
    // primera corrida con "try_catch: missing try branch". Una validación que
    // aprueba un flow que no puede correr enseña a no leerla.
    const tc = {
      id: "tc",
      type: "try_catch",
      label: "Intentar",
      config: {},
      position: { x: 0, y: 0 },
      purpose: "p",
    };
    const sinTry = validateStoredFlow(
      [trigger, tc, transform("y", "{}")],
      [
        { id: "e1", source: "t", target: "tc" },
        { id: "e2", source: "tc", target: "y" },
      ],
      { spec: "x" }
    );
    expect(sinTry.some((i) => i.level === "error" && i.nodeId === "tc")).toBe(true);

    const conTry = validateStoredFlow(
      [trigger, tc, transform("y", "{}")],
      [
        { id: "e1", source: "t", target: "tc" },
        { id: "e2", source: "tc", target: "y", sourceHandle: "try" },
      ],
      { spec: "x" }
    );
    expect(conTry.some((i) => i.level === "error")).toBe(false);
  });
  it("warns about a loop with no body, which runs and does nothing", () => {
    const issues = validateStoredFlow(
      [
        trigger,
        {
          id: "lp",
          type: "loop_for_each",
          label: "Por cada uno",
          config: { items: "{{contactos}}" },
          position: { x: 0, y: 0 },
          purpose: "p",
        },
      ],
      [{ id: "e1", source: "t", target: "lp" }],
      { spec: "x" }
    );
    expect(issues.some((i) => i.level === "warning" && i.nodeId === "lp")).toBe(true);
    expect(issues.some((i) => i.level === "error" && i.nodeId === "lp")).toBe(false);
  });
  it("returns documentation warnings, never errors, for missing spec and purpose", () => {
    const issues = validateStoredFlow(
      [trigger, transform("x", "{}", "")],
      [{ id: "e", source: "t", target: "x" }],
      {}
    );
    expect(
      issues
        .filter((i) => /documentación|propósito/.test(i.message))
        .every((i) => i.level === "warning")
    ).toBe(true);
    expect(issues.some((i) => /documentación/.test(i.message))).toBe(true);
  });
  it("accepts an empty graph", () => {
    expect(hasErrors(validateStoredFlow([], [], {}))).toBe(false);
  });
});

/**
 * Reglas que vinieron con `wait_human`, más una que faltaba desde antes.
 *
 * El `condition` sin una de sus ramas ya se podía guardar: medido el
 * 2026-10-03, un grafo así pasaba con cero issues. Es el mismo agujero que el
 * `try_catch` sin "Intentar" que cerró el PR #64, y se cuela más fácil porque
 * el flow "anda" — simplemente la mitad de los casos termina en silencio.
 */
describe("ramas que no se pueden olvidar", () => {
  const nodo = (id: string, type: string, label = id) => ({
    id,
    type,
    label,
    config: type === "condition" ? { left: "{{a}}", op: "==", right: "1" } : {},
    position: { x: 0, y: 0 },
    purpose: "Decidir",
  });
  const fin = (id: string) => transform(id, { ok: "1" });

  it("un condition sin la rama No es un error, no un aviso", () => {
    const r = validateStoredFlow(
      [trigger, nodo("c", "condition"), fin("a")],
      [
        { id: "e1", source: "t", target: "c" },
        { id: "e2", source: "c", target: "a", sourceHandle: "true" },
      ],
      {}
    );
    expect(hasErrors(r)).toBe(true);
    expect(r.some((i) => i.nodeId === "c" && i.level === "error")).toBe(true);
  });

  it("con las dos ramas conectadas, el condition pasa", () => {
    const r = validateStoredFlow(
      [trigger, nodo("c", "condition"), fin("a"), fin("b")],
      [
        { id: "e1", source: "t", target: "c" },
        { id: "e2", source: "c", target: "a", sourceHandle: "true" },
        { id: "e3", source: "c", target: "b", sourceHandle: "false" },
      ],
      {}
    );
    expect(r.filter((i) => i.nodeId === "c" && i.level === "error")).toHaveLength(0);
  });

  it("un wait_human sin la salida rechazado hace que aprobar y rechazar terminen igual", () => {
    const r = validateStoredFlow(
      [trigger, nodo("w", "wait_human", "Aprobar el MR"), fin("a")],
      [
        { id: "e1", source: "t", target: "w" },
        { id: "e2", source: "w", target: "a", sourceHandle: "aprobado" },
      ],
      {}
    );
    expect(hasErrors(r)).toBe(true);
    expect(r.some((i) => i.nodeId === "w" && /rechazado/.test(i.message))).toBe(true);
  });

  it("un wait_human adentro de un try_catch no se puede retomar, y se rechaza al guardar", () => {
    const r = validateStoredFlow(
      [
        trigger,
        nodo("tc", "try_catch", "Proteger"),
        nodo("w", "wait_human", "Aprobar"),
        fin("a"),
        fin("b"),
      ],
      [
        { id: "e1", source: "t", target: "tc" },
        { id: "e2", source: "tc", target: "w", sourceHandle: "try" },
        { id: "e3", source: "w", target: "a", sourceHandle: "aprobado" },
        { id: "e4", source: "w", target: "b", sourceHandle: "rechazado" },
      ],
      {}
    );
    expect(hasErrors(r)).toBe(true);
    expect(r.some((i) => i.nodeId === "w" && /bloque/.test(i.message))).toBe(true);
  });

  it("al nivel principal, el mismo wait_human pasa", () => {
    const r = validateStoredFlow(
      [trigger, nodo("w", "wait_human", "Aprobar"), fin("a"), fin("b")],
      [
        { id: "e1", source: "t", target: "w" },
        { id: "e2", source: "w", target: "a", sourceHandle: "aprobado" },
        { id: "e3", source: "w", target: "b", sourceHandle: "rechazado" },
      ],
      {}
    );
    expect(r.filter((i) => i.nodeId === "w" && i.level === "error")).toHaveLength(0);
  });
});
