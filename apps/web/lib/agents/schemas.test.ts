import { describe, it, expect } from "vitest";
import { updateAgentSchema } from "./schemas";

describe("updateAgentSchema", () => {
  const base = { name: "Agente de soporte", role: "Soporte" };

  it("accepts outputSchema null, which GET returns and the editor sends back", () => {
    // Rejecting null made every save from the agent editor fail with a 400,
    // unless the agent happened to use JSON output with a schema.
    expect(updateAgentSchema.safeParse({ ...base, outputSchema: null }).success).toBe(true);
  });

  it("still accepts a JSON Schema object", () => {
    const parsed = updateAgentSchema.safeParse({ ...base, outputSchema: { type: "object" } });
    expect(parsed.success).toBe(true);
  });

  it("rejects an outputSchema that is not an object", () => {
    expect(updateAgentSchema.safeParse({ ...base, outputSchema: "no" }).success).toBe(false);
  });

  it("still requires name and role", () => {
    expect(updateAgentSchema.safeParse({ model: "x" }).success).toBe(false);
  });
});
