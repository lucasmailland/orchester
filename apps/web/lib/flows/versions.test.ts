import { describe, it, expect } from "vitest";
import { versionSnapshot, restorePatch, changesTheGraph } from "./versions";

describe("flow versions carry the spec", () => {
  it("snapshots the spec with the graph", () => {
    expect(
      versionSnapshot({
        nodes: [{ id: "n" }],
        edges: null,
        variables: undefined,
        spec: "## Purpose",
      })
    ).toEqual({
      nodes: [{ id: "n" }],
      edges: [],
      variables: {},
      spec: "## Purpose",
    });
  });
  it("restores the spec with the graph, including a null spec", () => {
    expect(restorePatch({ nodes: [], edges: [], variables: { a: 1 }, spec: null })).toEqual({
      nodes: [],
      edges: [],
      variables: { a: 1 },
      spec: null,
    });
  });
});

describe("cuándo un cambio merece una versión", () => {
  const actual = {
    nodes: [{ id: "a" }],
    edges: [{ id: "e1" }],
    variables: { x: 1 },
    spec: "## Propósito\nHace algo.",
  };

  it("los nodos distintos la merecen", () => {
    expect(changesTheGraph(actual, { nodes: [{ id: "a" }, { id: "b" }] })).toBe(true);
  });

  it.each(["edges", "variables"] as const)("un cambio en %s también", (campo) => {
    expect(changesTheGraph(actual, { [campo]: [{ id: "otro" }] })).toBe(true);
  });

  it("reescribir la documentación también, que es parte del flow", () => {
    expect(changesTheGraph(actual, { spec: "## Propósito\nHace otra cosa." })).toBe(true);
  });

  it("mandar los MISMOS nodos no gasta una versión", () => {
    // La UI manda el grafo entero al guardar, aunque no se haya tocado nada.
    // Sin esta comparación, abrir y guardar llenaría el historial de ruido.
    expect(changesTheGraph(actual, { nodes: [{ id: "a" }], edges: [{ id: "e1" }] })).toBe(false);
  });

  it("pausar, reactivar o renombrar no deja versión", () => {
    // La retención conserva las últimas 20: un historial lleno de "lo pausé y
    // lo volví a activar" desaloja justo aquello a lo que uno querría volver.
    expect(changesTheGraph(actual, {})).toBe(false);
  });

  it("borrar el spec cuenta como cambio", () => {
    expect(changesTheGraph(actual, { spec: null })).toBe(true);
  });

  it("no confunde un spec ausente con uno vacío", () => {
    expect(changesTheGraph({ ...actual, spec: null }, { spec: null })).toBe(false);
    expect(changesTheGraph({ ...actual, spec: null }, { spec: "" })).toBe(true);
  });

  it("distingue el orden de los nodos", () => {
    // Reordenar cambia el grafo tal como queda guardado; volver atrás tiene
    // que devolver exactamente lo que había.
    expect(changesTheGraph(actual, { nodes: [{ id: "a" }, { id: "b" }] })).toBe(true);
    expect(
      changesTheGraph(
        { ...actual, nodes: [{ id: "a" }, { id: "b" }] },
        { nodes: [{ id: "b" }, { id: "a" }] }
      )
    ).toBe(true);
  });
});
