import { describe, it, expect, vi } from "vitest";
import { runFlowGraph } from "./flow-engine-harness";

vi.mock("@orchester/db", async () => (await import("./flow-engine-harness")).dbMock);
vi.mock("drizzle-orm", async () => vi.importActual("drizzle-orm"));
vi.mock("@/lib/queue", () => ({ enqueue: vi.fn(), JOB_FLOW_RUN: "flow.run" }));
vi.mock("@/lib/net-guard", () => ({ assertPublicUrl: vi.fn() }));
vi.mock("@/lib/observability", () => ({ recordMetric: vi.fn(), logWithContext: vi.fn() }));
vi.mock("@paralleldrive/cuid2", async () => {
  const { nextId } = await import("./flow-engine-harness");
  return { createId: () => nextId() };
});

type LlamadaAlModelo = { temperature?: number } & Record<string, unknown>;
const runChat = vi.fn(async (_params: LlamadaAlModelo) => ({
  content: "ok",
  tokensUsed: 5,
  model: "m",
}));
vi.mock("@/lib/ai/run", () => ({
  runChat: (params: LlamadaAlModelo) => runChat(params),
  chargeFor: () => ({ tokensIn: 0, tokensOut: 5, tokensTotal: 5, costUsd: 0 }),
}));

/** Los parámetros con que se llamó al modelo la primera vez. */
const loQueRecibio = (): LlamadaAlModelo => {
  const llamada = runChat.mock.calls[0];
  if (!llamada) throw new Error("no se llamó al modelo");
  return llamada[0];
};

const trigger = {
  id: "t",
  type: "trigger",
  label: "t",
  config: { triggerKind: "manual" },
  position: { x: 0, y: 0 },
};
const paso = (config: Record<string, unknown>) => ({
  id: "p",
  type: "llm_prompt",
  label: "p",
  config: { model: "bedrock:x", prompt: "decidí", ...config },
  position: { x: 0, y: 0 },
});
const correr = (config: Record<string, unknown>) =>
  runFlowGraph([trigger, paso(config)], [{ id: "e", source: "t", target: "p" }]);

describe("temperatura de un paso de modelo", () => {
  it("manda la temperatura que el paso declara", async () => {
    // Un paso que clasifica en tres opciones no quiere variedad: quiere la
    // misma respuesta ante la misma evidencia. Medido el 2026-09-20 sobre el
    // flow de análisis de código, la consistencia de un modelo caía a 0.67 —
    // contestaba distinto a la misma pregunta.
    runChat.mockClear();
    await correr({ temperature: 0 });
    expect(loQueRecibio()).toMatchObject({ temperature: 0 });
  });

  it("acepta el cero, que es justo el valor que importa", async () => {
    // `0` es falsy: con un chequeo por verdad en vez de por presencia, el
    // único valor que este cambio existe para permitir sería el que se pierde.
    runChat.mockClear();
    await correr({ temperature: "0" });
    expect(loQueRecibio()).toMatchObject({ temperature: 0 });
  });

  it("sin temperatura declarada no manda ninguna", async () => {
    // Los flows que ya existen fueron escritos y probados con el valor por
    // defecto del proveedor. Fijarles uno nuevo en silencio les cambiaría el
    // comportamiento sin que nadie haya tocado nada.
    runChat.mockClear();
    await correr({});
    expect(loQueRecibio()).not.toHaveProperty("temperature");
  });

  it("ignora una temperatura que no es un número", async () => {
    runChat.mockClear();
    await correr({ temperature: "tibia" });
    expect(loQueRecibio()).not.toHaveProperty("temperature");
  });
});
