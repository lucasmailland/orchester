// apps/web/tests/unit/embedding-tier.test.ts
//
// Unit tests for the Mnemosyne v1.6 tiered embedding resolver.
//
// Covered branches:
//   1. classifyEmbeddingTier — pure code, no IO.
//      - pinned → premium
//      - confidence >= 0.85 → premium
//      - workspace-scope + kind in {trait, preference, event} → premium
//      - workspace-scope + kind=other → default
//      - conversation-scope + pinned + high-conf → premium (pinned wins)
//      - conversation-scope + low-conf + kind=other → default
//      - tier='premium' override short-circuits → premium
//   2. resolveEmbeddingTier — async path with mocked workspace state.
//      - No provider configured → null (Mode A).
//      - default-tier fact + openai provider → { default, openai, default-model }.
//      - premium-tier fact + workspace has premium override → premium config.
//      - premium-tier fact + workspace has NO override → default config.
//        (Premium falls back to default; cost stays cheap.)

import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub all DB/settings access. The unit tests don't care about
// real provider rows or feature_flag reads — only that the resolver
// composes the right tier+provider+model when given specific inputs.
const aiProvidersMock = vi.fn();
const getMnemoSettingsMock = vi.fn();

vi.mock("@orchester/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => aiProvidersMock(),
      }),
    }),
  }),
  schema: {
    aiProviders: {
      workspaceId: "workspace_id",
      enabled: "enabled",
      provider: "provider",
    },
  },
}));

vi.mock("@/lib/embeddings", () => ({
  defaultEmbeddingModel: (provider: string) =>
    provider === "openai"
      ? "text-embedding-3-small"
      : provider === "google"
        ? "text-embedding-004"
        : "voyage-3",
}));

vi.mock("@/lib/settings/mnemo", () => ({
  getMnemoSettings: getMnemoSettingsMock,
}));

vi.mock("@/lib/safe-log", () => ({
  safeLogError: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: (..._args: unknown[]) => ({}),
  eq: (..._args: unknown[]) => ({}),
}));

let classifyEmbeddingTier: typeof import("@/lib/ai/embedding-tier").classifyEmbeddingTier;
let resolveEmbeddingTier: typeof import("@/lib/ai/embedding-tier").resolveEmbeddingTier;

beforeEach(async () => {
  aiProvidersMock.mockReset();
  getMnemoSettingsMock.mockReset();
  vi.resetModules();
  ({ classifyEmbeddingTier, resolveEmbeddingTier } = await import("@/lib/ai/embedding-tier"));
});

describe("classifyEmbeddingTier — pure rules", () => {
  it("pinned → premium", () => {
    expect(
      classifyEmbeddingTier({
        workspaceId: "ws_1",
        pinned: true,
        confidence: 0.1,
        scope: "conversation",
        factKind: "other",
      })
    ).toBe("premium");
  });

  it("confidence >= 0.85 → premium", () => {
    expect(
      classifyEmbeddingTier({
        workspaceId: "ws_1",
        confidence: 0.85,
        scope: "conversation",
        factKind: "other",
      })
    ).toBe("premium");
    expect(
      classifyEmbeddingTier({
        workspaceId: "ws_1",
        confidence: 0.95,
      })
    ).toBe("premium");
  });

  it("confidence < 0.85 + no other promotion → default", () => {
    expect(
      classifyEmbeddingTier({
        workspaceId: "ws_1",
        confidence: 0.8,
        scope: "conversation",
        factKind: "other",
      })
    ).toBe("default");
  });

  it("workspace-scope + kind=trait → premium", () => {
    expect(
      classifyEmbeddingTier({
        workspaceId: "ws_1",
        scope: "workspace",
        factKind: "trait",
        confidence: 0.5,
      })
    ).toBe("premium");
  });

  it("workspace-scope + kind=preference → premium", () => {
    expect(
      classifyEmbeddingTier({
        workspaceId: "ws_1",
        scope: "global",
        factKind: "preference",
      })
    ).toBe("premium");
  });

  it("workspace-scope + kind=event → premium", () => {
    expect(
      classifyEmbeddingTier({
        workspaceId: "ws_1",
        scope: "global",
        factKind: "event",
      })
    ).toBe("premium");
  });

  it("workspace-scope + kind=other → default", () => {
    expect(
      classifyEmbeddingTier({
        workspaceId: "ws_1",
        scope: "global",
        factKind: "other",
      })
    ).toBe("default");
  });

  it("conversation-scope + kind=trait → default (non-workspace doesn't promote)", () => {
    expect(
      classifyEmbeddingTier({
        workspaceId: "ws_1",
        scope: "conversation",
        factKind: "trait",
      })
    ).toBe("default");
  });

  it("tier='premium' override short-circuits", () => {
    expect(
      classifyEmbeddingTier({
        workspaceId: "ws_1",
        tier: "premium",
        scope: "conversation",
        factKind: "other",
      })
    ).toBe("premium");
  });

  it("tier='default' override short-circuits even when pinned", () => {
    expect(
      classifyEmbeddingTier({
        workspaceId: "ws_1",
        tier: "default",
        pinned: true,
      })
    ).toBe("default");
  });
});

describe("resolveEmbeddingTier — async resolution", () => {
  it("returns null when no provider configured (Mode A)", async () => {
    aiProvidersMock.mockResolvedValueOnce([]);
    const r = await resolveEmbeddingTier({
      workspaceId: "ws_1",
      factKind: "trait",
      scope: "global",
    });
    expect(r).toBeNull();
  });

  it("default tier + openai provider → text-embedding-3-small", async () => {
    aiProvidersMock.mockResolvedValueOnce([{ provider: "openai" }]);
    getMnemoSettingsMock.mockResolvedValueOnce({
      premiumEmbeddingProvider: null,
      premiumEmbeddingModel: null,
    });
    const r = await resolveEmbeddingTier({
      workspaceId: "ws_1",
      factKind: "other",
      scope: "conversation",
    });
    expect(r).toEqual({
      tier: "default",
      provider: "openai",
      model: "text-embedding-3-small",
    });
  });

  it("default tier + google provider → text-embedding-004", async () => {
    aiProvidersMock.mockResolvedValueOnce([{ provider: "google" }]);
    const r = await resolveEmbeddingTier({
      workspaceId: "ws_1",
      factKind: "other",
      scope: "conversation",
    });
    expect(r).toEqual({
      tier: "default",
      provider: "google",
      model: "text-embedding-004",
    });
  });

  it("openai preferred over google when both available", async () => {
    aiProvidersMock.mockResolvedValueOnce([{ provider: "google" }, { provider: "openai" }]);
    const r = await resolveEmbeddingTier({
      workspaceId: "ws_1",
      factKind: "other",
      scope: "conversation",
    });
    expect(r?.provider).toBe("openai");
  });

  it("premium classification + premium override set → premium config", async () => {
    aiProvidersMock.mockResolvedValueOnce([{ provider: "openai" }]);
    getMnemoSettingsMock.mockResolvedValueOnce({
      premiumEmbeddingProvider: "voyage",
      premiumEmbeddingModel: "voyage-3-large",
    });
    const r = await resolveEmbeddingTier({
      workspaceId: "ws_1",
      pinned: true,
      factKind: "trait",
      scope: "global",
    });
    expect(r).toEqual({
      tier: "premium",
      provider: "voyage",
      model: "voyage-3-large",
    });
  });

  it("premium classification + NO premium override → falls back to default", async () => {
    // The classifier still flags 'premium' but the resolver downgrades
    // to the default config so the fact still gets embedded — just
    // with the cheap-tier model. The returned tier is 'default' so
    // billing metering attributes correctly.
    aiProvidersMock.mockResolvedValueOnce([{ provider: "openai" }]);
    getMnemoSettingsMock.mockResolvedValueOnce({
      premiumEmbeddingProvider: null,
      premiumEmbeddingModel: null,
    });
    const r = await resolveEmbeddingTier({
      workspaceId: "ws_1",
      pinned: true,
      factKind: "trait",
      scope: "global",
    });
    expect(r?.tier).toBe("default");
    expect(r?.provider).toBe("openai");
  });

  it("premium classification + provider set but model NOT set → falls back to default", async () => {
    // Contract: BOTH provider and model must be set in workspace
    // settings for premium to take effect. Provider-only is treated
    // as incomplete config.
    aiProvidersMock.mockResolvedValueOnce([{ provider: "openai" }]);
    getMnemoSettingsMock.mockResolvedValueOnce({
      premiumEmbeddingProvider: "voyage",
      premiumEmbeddingModel: undefined,
    });
    const r = await resolveEmbeddingTier({
      workspaceId: "ws_1",
      pinned: true,
    });
    expect(r?.tier).toBe("default");
  });

  it("returns null and does not throw on DB failure", async () => {
    aiProvidersMock.mockRejectedValueOnce(new Error("simulated db outage"));
    const r = await resolveEmbeddingTier({
      workspaceId: "ws_1",
      factKind: "trait",
      scope: "global",
    });
    expect(r).toBeNull();
  });
});
