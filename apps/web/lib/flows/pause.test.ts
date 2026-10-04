import { describe, it, expect } from "vitest";
import { nuevoTokenDeAprobacion, workspaceDelToken, esDecision } from "./pause";

/**
 * El token de aprobación es la única credencial de quien aprueba, y además es
 * de dónde sale el workspace para poder consultar la base con contexto. Si
 * `workspaceDelToken` devuelve `undefined` donde debería devolver el workspace,
 * la aprobación contesta "este enlace no es válido" y el run queda pausado para
 * siempre; si devuelve algo donde debería devolver `undefined`, una consulta
 * sale con un workspace inventado.
 */
describe("token de aprobación", () => {
  it("devuelve el workspace que se le puso", () => {
    const token = nuevoTokenDeAprobacion("ws_abc123");
    expect(workspaceDelToken(token)).toBe("ws_abc123");
  });

  it("deja el secreto después del workspace, y es largo", () => {
    const token = nuevoTokenDeAprobacion("ws_abc123");
    const secreto = token.slice(token.indexOf(".") + 1);
    // Dos cuid2 pegados. El prefijo de workspace es público; esto no.
    expect(secreto.length).toBeGreaterThanOrEqual(40);
  });

  it("dos tokens del mismo workspace no se repiten", () => {
    const a = nuevoTokenDeAprobacion("ws_abc123");
    const b = nuevoTokenDeAprobacion("ws_abc123");
    expect(a).not.toBe(b);
  });

  it("sobrevive al viaje por una URL sin que se le escape nada", () => {
    const token = nuevoTokenDeAprobacion("ws_abc123");
    expect(encodeURIComponent(token)).toBe(token);
  });

  // Todo lo de abajo tiene que dar `undefined`: quien llama trata ese caso
  // igual que "no existe" y NO consulta la base.
  it.each([
    ["vacío", ""],
    ["sin el prefijo apr_", "ws_abc123.secretosecreto"],
    ["prefijo de otra cosa", "exp_ws_abc123.secreto"],
    ["sin separador", "apr_ws_abc123secretosecreto"],
    ["workspace vacío", "apr_.secretosecreto"],
    ["secreto vacío", "apr_ws_abc123."],
    ["sólo el prefijo", "apr_"],
    ["el separador justo donde arranca el workspace", "apr_."],
  ])("rechaza un token %s", (_caso, token) => {
    expect(workspaceDelToken(token)).toBeUndefined();
  });

  it("corta en el PRIMER separador, así un secreto con puntos no mueve el workspace", () => {
    expect(workspaceDelToken("apr_ws_abc123.algo.con.puntos")).toBe("ws_abc123");
  });
});

describe("esDecision", () => {
  it("acepta sólo las dos respuestas que el motor entiende", () => {
    expect(esDecision("aprobado")).toBe(true);
    expect(esDecision("rechazado")).toBe(true);
  });

  it.each([["aprobada"], ["APROBADO"], [""], ["sí"], ["true"]])("rechaza %s", (v) => {
    expect(esDecision(v)).toBe(false);
  });

  it("rechaza lo que no es un string", () => {
    expect(esDecision(true)).toBe(false);
    expect(esDecision(null)).toBe(false);
    expect(esDecision(undefined)).toBe(false);
    expect(esDecision({ decision: "aprobado" })).toBe(false);
  });
});
