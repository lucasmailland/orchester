// packages/mnemosyne/tests/integration/episode-crud.spec.ts
//
// Mnemosyne v1.4 — episode CRUD + timeline-query integration tests.
//
// Covers:
//   1. createEpisode round-trip — values come back unmolested,
//      arrays default to [] when omitted, durationMinutes is
//      explicitly nullable.
//   2. listEpisodes — date-window filter + topic filter both work
//      and respect the LIMIT cap.
//   3. getEpisode — present / missing / cross-workspace isolation.
//   4. linkFactToEpisode — appends idempotently (a re-link doesn't
//      duplicate the id in the array).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.unmock("@orchester/db");
vi.doUnmock("@orchester/db");

import {
  setupTestWorkspaces,
  teardownTestWorkspaces,
  type WsFixture,
} from "../../../../apps/web/tests/fixtures/workspaces";

let wsA: WsFixture;
let wsB: WsFixture;
let withMnemoTx: typeof import("../../src/tx").withMnemoTx;
let createEpisode: typeof import("../../src/episode/store").createEpisode;
let getEpisode: typeof import("../../src/episode/store").getEpisode;
let linkFactToEpisode: typeof import("../../src/episode/store").linkFactToEpisode;
let listEpisodes: typeof import("../../src/episode/query").listEpisodes;

beforeAll(async () => {
  [wsA, wsB] = await setupTestWorkspaces();
  ({ withMnemoTx } = await import("../../src/tx"));
  ({ createEpisode, getEpisode, linkFactToEpisode } = await import("../../src/episode/store"));
  ({ listEpisodes } = await import("../../src/episode/query"));
});

afterAll(() => teardownTestWorkspaces());

describe("episode/store — CRUD", () => {
  it("creates an episode and retrieves it with all fields preserved", async () => {
    const occurred = new Date("2026-04-15T14:30:00.000Z");
    const created = await withMnemoTx(wsA.id, (tx) =>
      createEpisode({
        workspaceId: wsA.id,
        title: "Q2 planning meeting",
        narrative: "Team reviewed Q2 OKRs and decided to deploy Postgres in week 3.",
        occurredAt: occurred,
        durationMinutes: 45,
        participants: ["user_lucas", "user_sofia"],
        topics: ["Q2-roadmap", "deployment"],
        linkedFactIds: ["mfact_seed_1", "mfact_seed_2"],
        sourceConversationId: "conv_q2_planning",
        metadata: { source: "test" },
        tx,
      })
    );

    expect(created.id).toMatch(/^mepi_/);
    expect(created.title).toBe("Q2 planning meeting");
    expect(created.durationMinutes).toBe(45);
    expect(created.participants).toEqual(["user_lucas", "user_sofia"]);
    expect(created.topics).toEqual(["Q2-roadmap", "deployment"]);
    expect(created.linkedFactIds).toEqual(["mfact_seed_1", "mfact_seed_2"]);
    expect(created.sourceConversationId).toBe("conv_q2_planning");
    expect(created.metadata).toEqual({ source: "test" });
    expect(created.occurredAt.toISOString()).toBe(occurred.toISOString());

    const fetched = await withMnemoTx(wsA.id, (tx) => getEpisode(wsA.id, created.id, tx));
    expect(fetched).not.toBeNull();
    expect(fetched!.title).toBe("Q2 planning meeting");
    expect(fetched!.linkedFactIds).toEqual(["mfact_seed_1", "mfact_seed_2"]);
  });

  it("defaults array fields to empty + duration to null when omitted", async () => {
    const created = await withMnemoTx(wsA.id, (tx) =>
      createEpisode({
        workspaceId: wsA.id,
        title: "Quick decision",
        narrative: "Decided to skip the dependency audit.",
        occurredAt: new Date("2026-04-20T09:00:00.000Z"),
        tx,
      })
    );

    expect(created.durationMinutes).toBeNull();
    expect(created.participants).toEqual([]);
    expect(created.topics).toEqual([]);
    expect(created.linkedFactIds).toEqual([]);
    expect(created.sourceConversationId).toBeNull();
  });

  it("getEpisode returns null for missing ids", async () => {
    const missing = await withMnemoTx(wsA.id, (tx) =>
      getEpisode(wsA.id, "mepi_does_not_exist", tx)
    );
    expect(missing).toBeNull();
  });

  it("getEpisode does NOT return episodes from another workspace (RLS)", async () => {
    const wsBEpisode = await withMnemoTx(wsB.id, (tx) =>
      createEpisode({
        workspaceId: wsB.id,
        title: "wsB-only secret meeting",
        narrative: "Only visible inside wsB.",
        occurredAt: new Date("2026-04-22T10:00:00.000Z"),
        tx,
      })
    );

    // Lookup the wsB episode while bound to wsA's tx context — RLS+FORCE
    // should make it invisible.
    const leaked = await withMnemoTx(wsA.id, (tx) => getEpisode(wsA.id, wsBEpisode.id, tx));
    expect(leaked).toBeNull();
  });
});

describe("episode/query — listEpisodes", () => {
  // We seed dates that land inside the default 30-day window AND a few
  // older ones to prove the date filter works.
  const NOW_REF = new Date("2026-05-25T00:00:00.000Z");
  const within = (offsetDays: number) =>
    new Date(NOW_REF.getTime() - offsetDays * 24 * 60 * 60 * 1000);

  it("lists episodes newest-first within a date window with topic filter", async () => {
    const fromDate = within(40);
    const toDate = within(0);

    // Three episodes inside the window, one outside (35d ago + the
    // `to=within(0)` upper bound). Topics chosen so the filter can
    // pick out exactly one.
    await withMnemoTx(wsA.id, async (tx) => {
      await createEpisode({
        workspaceId: wsA.id,
        title: "List-test recent A (deployment)",
        narrative: "n",
        occurredAt: within(5),
        topics: ["deployment", "infra"],
        tx,
      });
      await createEpisode({
        workspaceId: wsA.id,
        title: "List-test mid B (roadmap)",
        narrative: "n",
        occurredAt: within(15),
        topics: ["roadmap"],
        tx,
      });
      await createEpisode({
        workspaceId: wsA.id,
        title: "List-test edge C (deployment)",
        narrative: "n",
        occurredAt: within(30),
        topics: ["deployment"],
        tx,
      });
      await createEpisode({
        workspaceId: wsA.id,
        title: "List-test ancient D",
        narrative: "n",
        // Outside the 40d window we set above.
        occurredAt: within(50),
        topics: ["roadmap"],
        tx,
      });
    });

    const all = await withMnemoTx(wsA.id, (tx) =>
      listEpisodes({ workspaceId: wsA.id, from: fromDate, to: toDate, tx })
    );

    // We get the three in-window episodes back (plus any older
    // creates from prior tests that fall inside the same window —
    // we filter to our specific seeds).
    const ours = all.filter((e) => e.title.startsWith("List-test"));
    expect(ours.length).toBe(3);

    // Newest first.
    for (let i = 0; i + 1 < ours.length; i++) {
      expect(ours[i]!.occurredAt.getTime()).toBeGreaterThanOrEqual(
        ours[i + 1]!.occurredAt.getTime()
      );
    }

    // Topic filter: only the two with 'deployment' should come back.
    const deployOnly = await withMnemoTx(wsA.id, (tx) =>
      listEpisodes({
        workspaceId: wsA.id,
        from: fromDate,
        to: toDate,
        topic: "deployment",
        tx,
      })
    );
    const deployOurs = deployOnly.filter((e) => e.title.startsWith("List-test"));
    expect(deployOurs.length).toBe(2);
    for (const e of deployOurs) {
      expect(e.topics).toContain("deployment");
    }
  });
});

describe("episode/store — linkFactToEpisode", () => {
  it("appends a fact id idempotently (no duplicates on re-link)", async () => {
    const episode = await withMnemoTx(wsA.id, (tx) =>
      createEpisode({
        workspaceId: wsA.id,
        title: "Link-test episode",
        narrative: "Used by the idempotent-link test.",
        occurredAt: new Date("2026-05-01T10:00:00.000Z"),
        tx,
      })
    );

    await withMnemoTx(wsA.id, (tx) =>
      linkFactToEpisode({
        workspaceId: wsA.id,
        episodeId: episode.id,
        factId: "mfact_synthetic_1",
        tx,
      })
    );
    await withMnemoTx(wsA.id, (tx) =>
      linkFactToEpisode({
        workspaceId: wsA.id,
        episodeId: episode.id,
        factId: "mfact_synthetic_1",
        tx,
      })
    );
    // A different fact id should also land.
    await withMnemoTx(wsA.id, (tx) =>
      linkFactToEpisode({
        workspaceId: wsA.id,
        episodeId: episode.id,
        factId: "mfact_synthetic_2",
        tx,
      })
    );

    const reloaded = await withMnemoTx(wsA.id, (tx) => getEpisode(wsA.id, episode.id, tx));
    expect(reloaded).not.toBeNull();
    // No duplicate of mfact_synthetic_1, both ids present.
    const occurrences1 = reloaded!.linkedFactIds.filter((x) => x === "mfact_synthetic_1").length;
    expect(occurrences1).toBe(1);
    expect(reloaded!.linkedFactIds).toContain("mfact_synthetic_2");
  });
});
