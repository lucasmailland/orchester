import { describe, it, expect } from "vitest";
import { evaluateExpression, findTemplateErrors, FilterError } from "./filters";

const ctx = {
  issueId: "a1b2c3d4e5f6",
  at: 1_700_000_000_000,
  iso: "2023-11-14T22:13:20.000Z",
  name: "  Mixed Case  ",
  app: "user's-service",
  obj: { a: [1, 2] },
  empty: "",
  msg: "mail john.doe@example.com token Bearer abc.def-123 jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig id 123456789",
};

describe("evaluateExpression", () => {
  it("returns the raw value without filters", () => {
    expect(evaluateExpression("obj.a", ctx)).toEqual([1, 2]);
    expect(evaluateExpression("missing.path", ctx)).toBeUndefined();
  });
  it("addMinutes shifts epoch ms and ISO input", () => {
    expect(evaluateExpression("at | addMinutes:-15", ctx)).toBe(1_700_000_000_000 - 900_000);
    expect(evaluateExpression("iso | addMinutes:5", ctx)).toBe(1_700_000_000_000 + 300_000);
  });
  it("toIso and toEpochMs convert", () => {
    expect(evaluateExpression("at | toIso", ctx)).toBe("2023-11-14T22:13:20.000Z");
    expect(evaluateExpression("iso | toEpochMs", ctx)).toBe(1_700_000_000_000);
  });
  it("chains left to right", () => {
    expect(evaluateExpression("at | addMinutes:-1440 | toIso", ctx)).toBe(
      "2023-11-13T22:13:20.000Z"
    );
  });
  it("slice, lower, upper, trim", () => {
    expect(evaluateExpression("issueId | slice:0:8", ctx)).toBe("a1b2c3d4");
    expect(evaluateExpression("name | trim | lower", ctx)).toBe("mixed case");
    expect(evaluateExpression("name | trim | upper", ctx)).toBe("MIXED CASE");
  });
  it("default covers missing and empty values, and keeps colons", () => {
    expect(evaluateExpression("missing | default:unknown", ctx)).toBe("unknown");
    expect(evaluateExpression("empty | default:a:b", ctx)).toBe("a:b");
    expect(evaluateExpression("issueId | default:x", ctx)).toBe("a1b2c3d4e5f6");
  });
  it("json, nrql, html", () => {
    expect(evaluateExpression("obj | json", ctx)).toBe('{"a":[1,2]}');
    expect(evaluateExpression("app | nrql", ctx)).toBe("user\\'s-service");
    expect(evaluateExpression("app | html", ctx)).toBe("user&#39;s-service");
  });
  it("redact masks emails, bearer tokens, JWTs and long digit runs, then truncates", () => {
    const out = String(evaluateExpression("msg | redact:500", ctx));
    expect(out).not.toContain("john.doe@example.com");
    expect(out).not.toContain("abc.def-123");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(out).not.toContain("123456789");
    expect(out).toContain("[email]");
    expect(String(evaluateExpression("msg | redact:10", ctx)).length).toBeLessThanOrEqual(11);
  });
  it.each([
    ["api_key=abcdef123456", "api_key [secret]"],
    ["apikey=abcdefghij", "apikey [secret]"],
    ["Authorization: Bearer abcdef123456", "Authorization: Bearer [secret]"],
    ["token Bearer abc.def-123", "token Bearer [secret]"],
    ["the token was rotated", "the token was rotated"],
  ])("redacts credential syntax: %s", (msg, expected) => {
    expect(evaluateExpression("msg | redact:500", { msg })).toBe(expected);
  });
  it("throws on unknown filters and bad arguments", () => {
    expect(() => evaluateExpression("at | nope", ctx)).toThrow(FilterError);
    expect(() => evaluateExpression("at | addMinutes:abc", ctx)).toThrow(FilterError);
    expect(() => evaluateExpression("name | addMinutes:5", ctx)).toThrow(FilterError);
  });
});

describe("findTemplateErrors", () => {
  it("reports unknown filters and wrong argument counts", () => {
    expect(findTemplateErrors("x {{a | nope}} {{b | slice}}")).toHaveLength(2);
  });
  it("accepts valid templates and plain text", () => {
    expect(findTemplateErrors("SINCE {{at | addMinutes:-15}} {{plain}} no braces")).toEqual([]);
  });
});

describe("json con indentación", () => {
  it("sigue compacto sin argumento", () => {
    expect(evaluateExpression("obj | json", ctx)).toBe('{"a":[1,2]}');
  });

  it("indenta cuando se lo piden", () => {
    expect(evaluateExpression("obj | json:2", ctx)).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
  });
});

describe("table", () => {
  const filas = {
    deploys: [
      { hora: "14:02", servicio: "auth-service", rev: "a3f21c" },
      { hora: "14:31", servicio: "auth-service", rev: "b19e04" },
    ],
  };

  it("arma una tabla con encabezados a partir de las claves", () => {
    expect(evaluateExpression("deploys | table", filas)).toBe(
      "<table><thead><tr><th>hora</th><th>servicio</th><th>rev</th></tr></thead>" +
        "<tbody><tr><td>14:02</td><td>auth-service</td><td>a3f21c</td></tr>" +
        "<tr><td>14:31</td><td>auth-service</td><td>b19e04</td></tr></tbody></table>"
    );
  });

  it("escapa el contenido, porque esto termina dentro de un campo HTML", () => {
    // Un `<` en un mensaje de error partiría el markup de la nota entera.
    const malo = { filas: [{ msg: '<script>alert("x")</script>' }] };
    const salida = evaluateExpression("filas | table", malo) as string;
    expect(salida).toContain("&lt;script&gt;");
    expect(salida).not.toContain("<script>");
  });

  it("no pierde una columna que le falta a una fila", () => {
    const dispar = { filas: [{ a: 1 }, { b: 2 }] };
    const salida = evaluateExpression("filas | table", dispar) as string;
    expect(salida).toContain("<th>a</th><th>b</th>");
    // La celda ausente queda vacía, no dice "undefined".
    expect(salida).toContain("<tr><td>1</td><td></td></tr>");
  });

  it("corta las filas de más y dice cuántas quedaron afuera", () => {
    // Leer 20 filas y creer que son todas es peor que ver 2 y saber que faltan.
    const muchas = { filas: Array.from({ length: 25 }, (_, i) => ({ n: i })) };
    const salida = evaluateExpression("filas | table:2", muchas) as string;
    expect(salida).toContain("<td>0</td>");
    expect(salida).toContain("<td>1</td>");
    expect(salida).not.toContain("<td>2</td>");
    expect(salida).toContain("23 fila(s) más");
  });

  it("recorta una celda larga", () => {
    const larga = { filas: [{ msg: "x".repeat(50) }] };
    expect(evaluateExpression("filas | table:10:20", larga)).toContain("x".repeat(20) + "…");
  });

  it("devuelve vacío cuando no hay filas", () => {
    expect(evaluateExpression("filas | table", { filas: [] })).toBe("");
    expect(evaluateExpression("nada | table", {})).toBe("");
  });

  it("cae a una lista cuando los elementos no son objetos", () => {
    // Una tabla de una sola columna sin nombre no dice nada que la lista no diga.
    expect(evaluateExpression("filas | table", { filas: ["uno", "dos"] })).toBe(
      "<ul><li>uno</li><li>dos</li></ul>"
    );
  });
});
