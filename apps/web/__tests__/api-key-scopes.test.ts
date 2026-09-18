// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ALL_SCOPES,
  PRE_SCOPES_DEFAULT,
  SCOPE_DOMAINS,
  isKnownScope,
  missingScopeMessage,
  scopesAllow,
} from "@/lib/api-auth/scopes";

describe("the scope vocabulary", () => {
  it("offers read and write for every domain, and nothing else", () => {
    expect(ALL_SCOPES).toEqual(SCOPE_DOMAINS.flatMap((d) => [`${d}:read`, `${d}:write`]));
    expect(ALL_SCOPES).toHaveLength(SCOPE_DOMAINS.length * 2);
  });

  it.each(["flows:write", "memory:read", "conversations:write"])("accepts %s", (scope) => {
    expect(isKnownScope(scope)).toBe(true);
  });

  it.each(["flows", "flows:admin", "everything", "", "FLOWS:WRITE", "readonly", "write"])(
    "refuses %s as something a new key can be given",
    (scope) => {
      // `readonly` and `write` are still honoured when read off an old key, but
      // they are not part of the vocabulary a new key is created from.
      expect(isKnownScope(scope)).toBe(false);
    }
  );
});

describe("what a key is allowed to do", () => {
  it("allows exactly the domain and access it was given", () => {
    expect(scopesAllow(["flows:read"], "flows", "read")).toBe(true);
    expect(scopesAllow(["flows:read"], "flows", "write")).toBe(false);
  });

  it("does not let one domain reach another", () => {
    // The whole point: a key for editing flows must not touch agents, and a
    // key for reading conversations must not read memory.
    expect(scopesAllow(["flows:write"], "agents", "read")).toBe(false);
    expect(scopesAllow(["conversations:read"], "memory", "read")).toBe(false);
  });

  it("treats write as including read on the same domain", () => {
    expect(scopesAllow(["flows:write"], "flows", "read")).toBe(true);
  });

  it("checks reads, which is what this fixes", () => {
    // Reads used to be waved through entirely, so a key labelled readonly could
    // read every agent, conversation and flow in the workspace.
    expect(scopesAllow(["agents:read"], "conversations", "read")).toBe(false);
    expect(scopesAllow(["readonly"], "agents", "read")).toBe(false);
  });

  describe("keys that predate the vocabulary", () => {
    it("still reads an empty list as full access", () => {
      // Until the migration has run everywhere, this is how most keys are
      // stored. Denying them would lock working integrations out on deploy.
      expect(scopesAllow([], "flows", "write")).toBe(true);
      expect(scopesAllow([], "memory", "read")).toBe(true);
    });

    it("still honours the legacy readonly and write markers", () => {
      expect(scopesAllow(["readonly"], "flows", "write")).toBe(false);
      expect(scopesAllow(["write"], "flows", "write")).toBe(true);
      expect(scopesAllow(["write"], "employees", "read")).toBe(true);
    });

    it("keeps readonly winning over anything permissive beside it", () => {
      // A blocklist would have let `["readonly","flows:write"]` write.
      expect(scopesAllow(["readonly", "flows:write"], "flows", "write")).toBe(false);
    });

    it("gives the old default no more than the two domains it names", () => {
      // It read as unrestricted only because reads were unchecked. Now it is
      // what it says, and the migration widens the real keys explicitly.
      expect(scopesAllow(PRE_SCOPES_DEFAULT, "flows", "write")).toBe(true);
      expect(scopesAllow(PRE_SCOPES_DEFAULT, "agents", "write")).toBe(true);
      expect(scopesAllow(PRE_SCOPES_DEFAULT, "memory", "read")).toBe(false);
      expect(scopesAllow(PRE_SCOPES_DEFAULT, "conversations", "read")).toBe(false);
    });
  });

  it("refuses a malformed scope list rather than trusting it", () => {
    expect(scopesAllow(["flows:read"], "flows", "write")).toBe(false);
    expect(scopesAllow(["flows:*"], "flows", "write")).toBe(false);
    expect(scopesAllow(["flows:Write"], "flows", "write")).toBe(false);
  });

  it("names the permission that is missing", () => {
    // "Forbidden" tells an operator nothing; the scope to add tells them everything.
    expect(missingScopeMessage("flows", "write")).toContain("flows:write");
  });
});
