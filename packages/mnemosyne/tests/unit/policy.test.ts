// packages/mnemosyne/tests/unit/policy.test.ts
//
// Pure unit tests for the v1.4 per-agent memory policy module. No DB,
// no host. Validates:
//   1. `parseAgentMemoryPolicy` rejects malformed shapes and accepts
//      the canonical default.
//   2. `applyPolicyToRecall` translates `read_scopes` into
//      `SearchMnemoInput` mutations without overriding explicit caller
//      values.
//   3. `applyPolicyToWrite` honors `write_scope_default` and downgrades
//      to agent partition when sensitive PII is present.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_AGENT_MEMORY_POLICY,
  parseAgentMemoryPolicy,
  applyPolicyToRecall,
  applyPolicyToWrite,
  type AgentMemoryPolicy,
} from "../../src/policy";
import type { SearchMnemoInput } from "../../src/recall/search";
import type { CreateFactInput } from "../../src/primitives/fact";
import type { Tx } from "../../src/tx";

const FAKE_TX = {} as unknown as Tx;

function makeRecallBase(): SearchMnemoInput {
  return {
    workspaceId: "ws_test",
    query: "what does the user prefer",
  };
}

function makeWriteBase(): CreateFactInput {
  return {
    workspaceId: "ws_test",
    scope: "global",
    kind: "preference",
    subject: "user",
    statement: "prefers TypeScript",
    tx: FAKE_TX,
  };
}

describe("policy/parseAgentMemoryPolicy", () => {
  it("accepts the canonical default", () => {
    const out = parseAgentMemoryPolicy(DEFAULT_AGENT_MEMORY_POLICY);
    expect(out).toEqual(DEFAULT_AGENT_MEMORY_POLICY);
  });

  it("rejects null", () => {
    expect(() => parseAgentMemoryPolicy(null)).toThrow();
  });

  it("rejects empty object", () => {
    expect(() => parseAgentMemoryPolicy({})).toThrow();
  });

  it("rejects invalid write_scope_default", () => {
    expect(() =>
      parseAgentMemoryPolicy({
        write_scope_default: "team",
        read_scopes: ["workspace"],
        sensitive_categories: [],
      })
    ).toThrow(/write_scope_default/);
  });

  it("rejects empty read_scopes", () => {
    expect(() =>
      parseAgentMemoryPolicy({
        write_scope_default: "workspace",
        read_scopes: [],
        sensitive_categories: [],
      })
    ).toThrow(/read_scopes/);
  });

  it("rejects invalid scope value in read_scopes", () => {
    expect(() =>
      parseAgentMemoryPolicy({
        write_scope_default: "workspace",
        read_scopes: ["workspace", "garbage"],
        sensitive_categories: [],
      })
    ).toThrow(/read_scopes/);
  });

  it("dedupes read_scopes + sensitive_categories", () => {
    const out = parseAgentMemoryPolicy({
      write_scope_default: "agent",
      read_scopes: ["workspace", "agent", "workspace"],
      sensitive_categories: ["email", "email", "phone"],
    });
    expect(out.read_scopes).toEqual(["workspace", "agent"]);
    expect(out.sensitive_categories).toEqual(["email", "phone"]);
  });

  it("rejects non-string sensitive_categories entries", () => {
    expect(() =>
      parseAgentMemoryPolicy({
        write_scope_default: "workspace",
        read_scopes: ["workspace"],
        sensitive_categories: ["email", 42],
      })
    ).toThrow(/sensitive_categories/);
  });
});

describe("policy/applyPolicyToRecall", () => {
  it("is a no-op for the default policy", () => {
    const base = makeRecallBase();
    const out = applyPolicyToRecall(DEFAULT_AGENT_MEMORY_POLICY, base);
    expect(out.scope).toBeUndefined();
  });

  it("respects an explicit scope on the caller", () => {
    const policy: AgentMemoryPolicy = {
      write_scope_default: "workspace",
      read_scopes: ["workspace"],
      sensitive_categories: [],
    };
    const base = { ...makeRecallBase(), scope: "conversation" as const };
    const out = applyPolicyToRecall(policy, base);
    expect(out.scope).toBe("conversation");
  });

  it("restricts to 'global' when read_scopes is ['workspace'] only", () => {
    const policy: AgentMemoryPolicy = {
      write_scope_default: "workspace",
      read_scopes: ["workspace"],
      sensitive_categories: [],
    };
    const base = makeRecallBase();
    const out = applyPolicyToRecall(policy, base);
    expect(out.scope).toBe("global");
  });

  it("leaves input untouched when read_scopes is ['agent']", () => {
    // Policy expresses agent-only intent, but the recall SQL doesn't
    // have a strict-agent mode yet — documented limitation, lands in
    // v2.0. v1.4 is conservative: don't pretend to enforce.
    const policy: AgentMemoryPolicy = {
      write_scope_default: "agent",
      read_scopes: ["agent"],
      sensitive_categories: [],
    };
    const base = makeRecallBase();
    const out = applyPolicyToRecall(policy, base);
    expect(out.scope).toBeUndefined();
  });
});

describe("policy/applyPolicyToWrite", () => {
  it("is a no-op for the default policy when no PII detected", () => {
    const base = makeWriteBase();
    const out = applyPolicyToWrite(DEFAULT_AGENT_MEMORY_POLICY, base, []);
    expect(out.scope).toBe("global");
  });

  it("downgrades scope to 'global' (agent partition) when sensitive PII intersects", () => {
    const policy: AgentMemoryPolicy = {
      write_scope_default: "workspace",
      read_scopes: ["workspace", "agent"],
      sensitive_categories: ["email", "ssn"],
    };
    const base = { ...makeWriteBase(), agentId: "agent_a", scope: "global" as const };
    const out = applyPolicyToWrite(policy, base, ["email"]);
    expect(out.scope).toBe("global");
    expect(out.agentId).toBe("agent_a"); // agent_id preserved as the partition key
  });

  it("translates write_scope_default='conversation' to FactScope 'conversation'", () => {
    const policy: AgentMemoryPolicy = {
      write_scope_default: "conversation",
      read_scopes: ["workspace", "agent", "conversation"],
      sensitive_categories: [],
    };
    const base = {
      ...makeWriteBase(),
      scope: "global" as const,
      scopeRef: "conv_xyz",
    };
    const out = applyPolicyToWrite(policy, base, []);
    expect(out.scope).toBe("conversation");
    expect(out.scopeRef).toBe("conv_xyz");
  });

  it("respects an explicit non-global scope on the caller", () => {
    const policy: AgentMemoryPolicy = {
      write_scope_default: "workspace",
      read_scopes: ["workspace"],
      sensitive_categories: ["email"],
    };
    const base = { ...makeWriteBase(), scope: "team" as const };
    const out = applyPolicyToWrite(policy, base, ["email"]);
    // Caller said 'team' explicitly — policy doesn't override.
    expect(out.scope).toBe("team");
  });

  it("is idempotent — applying twice yields the same result", () => {
    const policy: AgentMemoryPolicy = {
      write_scope_default: "workspace",
      read_scopes: ["workspace", "agent"],
      sensitive_categories: ["api_key"],
    };
    const base = { ...makeWriteBase(), agentId: "agent_a" };
    const once = applyPolicyToWrite(policy, base, ["api_key"]);
    const twice = applyPolicyToWrite(policy, once, ["api_key"]);
    expect(twice).toEqual(once);
  });
});
