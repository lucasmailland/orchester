import { describe, it, expect } from "vitest";
import { createApprovalToken, workspaceFromApprovalToken, isApprovalDecision } from "./pause";

/**
 * The approval token is the approver's only credential, and also provides the
 * workspace needed to query the database with context. If
 * `workspaceFromApprovalToken` returns `undefined` instead of the workspace,
 * approval answers "this link is invalid" and the run stays paused forever;
 * if it returns something instead of `undefined`, a query runs with a
 * fabricated workspace.
 */
describe("approval token", () => {
  it("returns the workspace it was given", () => {
    const token = createApprovalToken("ws_abc123");
    expect(workspaceFromApprovalToken(token)).toBe("ws_abc123");
  });

  it("places a long secret after the workspace", () => {
    const token = createApprovalToken("ws_abc123");
    const secret = token.slice(token.indexOf(".") + 1);
    // Two concatenated cuid2 values. The workspace prefix is public; this is not.
    expect(secret.length).toBeGreaterThanOrEqual(40);
  });

  it("does not repeat tokens for the same workspace", () => {
    const a = createApprovalToken("ws_abc123");
    const b = createApprovalToken("ws_abc123");
    expect(a).not.toBe(b);
  });

  it("survives a URL round trip without escaping", () => {
    const token = createApprovalToken("ws_abc123");
    expect(encodeURIComponent(token)).toBe(token);
  });

  // Everything below must return `undefined`: the caller treats that case
  // as "does not exist" and does NOT query the database.
  it.each([
    ["empty", ""],
    ["without the apr_ prefix", "ws_abc123.secretsecret"],
    ["with an unrelated prefix", "exp_ws_abc123.secret"],
    ["without a separator", "apr_ws_abc123secretsecret"],
    ["empty workspace", "apr_.secretsecret"],
    ["empty secret", "apr_ws_abc123."],
    ["with only the prefix", "apr_"],
    ["with the separator where the workspace starts", "apr_."],
  ])("rejects a token %s", (_case, token) => {
    expect(workspaceFromApprovalToken(token)).toBeUndefined();
  });

  it("splits at the FIRST separator so dots in the secret do not shift the workspace", () => {
    expect(workspaceFromApprovalToken("apr_ws_abc123.something.with.dots")).toBe("ws_abc123");
  });
});

describe("isApprovalDecision", () => {
  it("accepts only the two responses the engine understands", () => {
    expect(isApprovalDecision("aprobado")).toBe(true);
    expect(isApprovalDecision("rechazado")).toBe(true);
  });

  it.each([["aprobada"], ["APROBADO"], [""], ["sí"], ["true"]])("rejects %s", (v) => {
    expect(isApprovalDecision(v)).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isApprovalDecision(true)).toBe(false);
    expect(isApprovalDecision(null)).toBe(false);
    expect(isApprovalDecision(undefined)).toBe(false);
    expect(isApprovalDecision({ decision: "aprobado" })).toBe(false);
  });
});
