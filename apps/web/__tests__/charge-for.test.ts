// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@orchester/db", () => ({ getDb: vi.fn(), schema: {} }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn(), sql: vi.fn() }));
vi.mock("@/lib/encryption", () => ({ decrypt: () => "x" }));
vi.mock("@/lib/observability", () => ({ recordMetric: vi.fn(), logWithContext: vi.fn() }));

const { chargeFor } = await import("@/lib/ai/run");
const { calculateChatCostUsd } = await import("@/lib/pricing");

// Precio conocido del catálogo: entrada 0.0011, salida 0.0055 por 1k.
const HAIKU = "us.anthropic.claude-haiku-4-5-20251001-v1:0";

describe("cómo se cobra una respuesta", () => {
  it("cobra cada mitad a su precio cuando el proveedor da el desglose", () => {
    const cargo = chargeFor({
      model: HAIKU,
      tokensUsed: 11_000,
      tokensIn: 10_000,
      tokensOut: 1_000,
    });
    expect(cargo).toEqual({
      tokensIn: 10_000,
      tokensOut: 1_000,
      tokensTotal: 11_000,
      costUsd: calculateChatCostUsd(HAIKU, 10_000, 1_000),
    });
  });

  it("deja de inflar el costo de una llamada con mucha entrada", () => {
    // Éste es el caso real del pipeline: se le manda un archivo entero al
    // modelo y contesta un párrafo. Cobrar los 10.000 de entrada al precio de
    // salida multiplicaba el costo por cinco.
    const antes = calculateChatCostUsd(HAIKU, 0, 11_000);
    const ahora = chargeFor({
      model: HAIKU,
      tokensUsed: 11_000,
      tokensIn: 10_000,
      tokensOut: 1_000,
    }).costUsd;
    expect(ahora).toBeLessThan(antes);
    expect(antes / ahora).toBeGreaterThan(3);
  });

  it("sin desglose sobreestima, como antes, y no subestima", () => {
    // El tope de gasto lee este número: quedarse corto deja pasar gasto real.
    // Quedarse largo sólo corta antes, que es el lado seguro del error.
    const cargo = chargeFor({ model: HAIKU, tokensUsed: 5_000 });
    expect(cargo.tokensIn).toBe(0);
    expect(cargo.tokensOut).toBe(5_000);
    expect(cargo.costUsd).toBe(calculateChatCostUsd(HAIKU, 0, 5_000));
  });

  it("no toma un desglose a medias", () => {
    // Un proveedor que informe sólo una mitad daría un costo que parece exacto
    // y no lo es. Mejor caer al camino conocido.
    expect(chargeFor({ model: HAIKU, tokensUsed: 500, tokensIn: 400 }).tokensOut).toBe(500);
    expect(chargeFor({ model: HAIKU, tokensUsed: 500, tokensOut: 100 }).tokensIn).toBe(0);
  });

  it("acepta un desglose en cero sin confundirlo con su ausencia", () => {
    // Una respuesta vacía informa 0 tokens de salida; eso es un dato, no un
    // faltante, y `0` es falsy — el chequeo tiene que ser por undefined.
    const cargo = chargeFor({ model: HAIKU, tokensUsed: 700, tokensIn: 700, tokensOut: 0 });
    expect(cargo.tokensOut).toBe(0);
    expect(cargo.costUsd).toBe(calculateChatCostUsd(HAIKU, 700, 0));
  });

  it("conserva el total tal como lo informó el proveedor", () => {
    // El total puede incluir tokens que el desglose no nombra (caché, por
    // ejemplo). Recalcularlo como suma perdería esa diferencia en silencio.
    const cargo = chargeFor({ model: HAIKU, tokensUsed: 900, tokensIn: 400, tokensOut: 300 });
    expect(cargo.tokensTotal).toBe(900);
  });
});
