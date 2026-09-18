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
    const salida = evaluateExpression("deploys | table", filas) as string;
    expect(salida).toContain("<th style=");
    expect(salida).toContain(">hora</th>");
    expect(salida).toContain(">servicio</th>");
    expect(salida).toContain(">rev</th>");
    expect(salida).toContain(">14:02</td>");
    expect(salida).toContain(">b19e04</td>");
  });

  it("lleva los bordes en el atributo style y no en clases", () => {
    // Esto se embebe en HTML de otro: no hay hoja de estilos nuestra del otro
    // lado, y una clase de Bootstrap sólo pinta si el destino usa Bootstrap.
    const salida = evaluateExpression("deploys | table", filas) as string;
    expect(salida).toContain("border-collapse:collapse");
    expect(salida).toContain("border:1px solid");
    expect(salida).not.toContain("class=");
  });

  describe("fechas legibles", () => {
    it("convierte un epoch en una columna que se llama timestamp", () => {
      const datos = { logs: [{ timestamp: 1789769424158, level: "info" }] };
      expect(evaluateExpression("logs | table", datos)).toContain("2026-09-18 ");
    });

    it.each(["time", "date", "fecha", "hora", "created_at", "closedAt"])(
      "también en una columna %s",
      (col) => {
        const datos = { logs: [{ [col]: 1789769424158 }] };
        expect(evaluateExpression("logs | table", datos)).toContain("2026-09-18 ");
      }
    );

    it("no toca una cantidad que da la casualidad de ser grande", () => {
      // Sin el chequeo del nombre, un contador se disfrazaría de fecha.
      const datos = { filas: [{ count: 1789769424158 }] };
      expect(evaluateExpression("filas | table", datos)).toContain(">1789769424158</td>");
    });

    it("no toca un número fuera del rango de épocas creíbles", () => {
      const datos = { filas: [{ timestamp: 42 }] };
      expect(evaluateExpression("filas | table", datos)).toContain(">42</td>");
    });

    it("deja en paz un instante que ya viene como texto", () => {
      const datos = { filas: [{ timestamp: "2026-09-18T14:02:11Z" }] };
      expect(evaluateExpression("filas | table", datos)).toContain(">2026-09-18T14:02:11Z</td>");
    });
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
    expect(salida).toMatch(/<th[^>]*>a<\/th><th[^>]*>b<\/th>/);
    // La celda ausente queda vacía, no dice "undefined".
    expect(salida).toMatch(/<td[^>]*>1<\/td><td[^>]*><\/td>/);
  });

  it("corta las filas de más y dice cuántas quedaron afuera", () => {
    // Leer 20 filas y creer que son todas es peor que ver 2 y saber que faltan.
    const muchas = { filas: Array.from({ length: 25 }, (_, i) => ({ n: i })) };
    const salida = evaluateExpression("filas | table:2", muchas) as string;
    expect(salida).toContain(">0</td>");
    expect(salida).toContain(">1</td>");
    expect(salida).not.toContain(">2</td>");
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
