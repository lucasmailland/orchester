// apps/web/tests/unit/mnemo-export-scope.spec.ts
//
// SEC-4: verify exportWorkspaceData forwards the caller's workspace id
// to the Mnemosyne client, not relying on the process-wide MNEMO_API_KEY
// to imply the workspace scope.
import { describe, it, expect, vi, beforeEach } from "vitest";

const exportWorkspace = vi.fn().mockResolvedValue({
  facts: [],
  decisions: [],
  relations: [],
  citations: [],
});

vi.mock("@/lib/mnemo/client", () => ({
  getMnemoMode: () => "service",
  getMnemoClient: () => ({ exportWorkspace }),
}));

beforeEach(() => exportWorkspace.mockClear());

describe("SEC-4: mnemo export scopes by caller workspace", () => {
  it("forwards the workspace id to the client", async () => {
    const { exportWorkspaceData } = await import("@/lib/mnemo/export");
    await exportWorkspaceData("ws-A");
    expect(exportWorkspace).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "ws-A" }));
  });
});
