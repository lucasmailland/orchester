import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@mnemo-ai/client-ts", () => ({
  MnemosyneClient: class {
    constructor(public opts: unknown) {}
  },
}));

import { getMnemoClient, MnemoWorkspaceNotBoundError } from "@/lib/mnemo/client";

// Orchester holds one process-wide Mnemosyne key, so the client is bound to
// the single workspace the deployment names for it.
describe("getMnemoClient workspace binding", () => {
  beforeEach(() => {
    vi.stubEnv("MNEMO_URL", "http://mnemo.test");
    vi.stubEnv("MNEMO_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the client for the bound workspace", () => {
    vi.stubEnv("MNEMO_BOUND_WORKSPACE_ID", "ws_owner");
    expect(getMnemoClient("ws_owner")).toBeDefined();
  });

  it("refuses any other workspace", () => {
    vi.stubEnv("MNEMO_BOUND_WORKSPACE_ID", "ws_owner");
    expect(() => getMnemoClient("ws_other")).toThrow(MnemoWorkspaceNotBoundError);
  });

  it("refuses every workspace when no binding is configured", () => {
    vi.stubEnv("MNEMO_BOUND_WORKSPACE_ID", "");
    expect(() => getMnemoClient("ws_owner")).toThrow(MnemoWorkspaceNotBoundError);
  });

  it("refuses an empty workspace id", () => {
    vi.stubEnv("MNEMO_BOUND_WORKSPACE_ID", "ws_owner");
    expect(() => getMnemoClient("")).toThrow(MnemoWorkspaceNotBoundError);
  });
});
