import { describe, it, expect } from "vitest";
import { interpolate } from "@/lib/flow-engine";

describe("interpolate", () => {
  it("keeps strings and numbers as they are", () => {
    expect(interpolate("Hola {{name}}, tenés {{n}}", { name: "Ana", n: 3 })).toBe(
      "Hola Ana, tenés 3"
    );
  });

  it("renders an object as JSON instead of [object Object]", () => {
    // An http step parses a JSON response into an object, so a prompt that read
    // {{httpResult}} used to send the model the literal "[object Object]".
    expect(interpolate("Datos: {{r}}", { r: { plan: "pro", seats: 4 } })).toBe(
      'Datos: {"plan":"pro","seats":4}'
    );
  });

  it("renders an array of objects as JSON", () => {
    // kb_search leaves its results as an array of { text, ... }.
    expect(interpolate("KB: {{knowledge}}", { knowledge: [{ text: "Reset password" }] })).toBe(
      'KB: [{"text":"Reset password"}]'
    );
  });

  it("still resolves paths into objects and arrays", () => {
    expect(interpolate("{{knowledge.0.text}}", { knowledge: [{ text: "Reset password" }] })).toBe(
      "Reset password"
    );
  });

  it("renders missing and null values as empty", () => {
    expect(interpolate("[{{a}}][{{b}}]", { b: null })).toBe("[][]");
  });
});
