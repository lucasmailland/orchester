// apps/web/tests/unit/workspace/gdpr-export-progress-state.spec.ts
//
// Unit tests for `setExportJobId` + the persisted state shape it writes
// to localStorage. The fix that motivated this suite is F-D6: the
// component used to store the bare jobId string and key SWR off
// `useParams().workspaceSlug`. That meant navigating to a different
// workspace would re-point the polling URL at the wrong tenant and
// silently 404 forever.
//
// We don't render the component here — that would pull in next/navigation
// + next-intl which need a full app shell. The behaviour under test is
// just the persistence helper, which is the seam every caller goes through.
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";

const LS_KEY = "orch-gdpr-export-job";

// jsdom in this project ships without an active `localStorage`
// implementation (the harness overrides Window properties before tests
// boot). Install a minimal in-memory polyfill so the persistence helper
// has something to write into.
beforeAll(() => {
  if (typeof window.localStorage === "undefined" || !window.localStorage?.setItem) {
    const store = new Map<string, string>();
    const ls = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    };
    Object.defineProperty(window, "localStorage", {
      value: ls,
      configurable: true,
      writable: true,
    });
  }
});

// Import AFTER the polyfill is in place — the component module reads
// `typeof window === "undefined"` at call time, so order doesn't matter
// for it, but keeping the import after beforeAll makes the dependency
// explicit.
import { setExportJobId } from "@/components/workspace/GdprExportProgress";

beforeEach(() => {
  window.localStorage.removeItem(LS_KEY);
});

describe("setExportJobId (F-D6: slug bound to jobId)", () => {
  it("persists slug + jobId together as a JSON envelope", () => {
    setExportJobId("job_abc", "acme-hr");
    const raw = window.localStorage.getItem(LS_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed).toEqual({ slug: "acme-hr", jobId: "job_abc" });
  });

  it("throws if called without a slug (forces callers to migrate)", () => {
    // Refusing the legacy signature loudly is the only way we can be
    // sure no caller is silently writing a bare-string entry that
    // would then be dropped by the parser as legacy data.
    expect(() => setExportJobId("job_abc")).toThrowError(/requires a slug/);
  });

  it("clears the key on null and dispatches a synthetic storage event", () => {
    // Seed something first so we can observe the clear.
    setExportJobId("job_abc", "acme-hr");
    expect(window.localStorage.getItem(LS_KEY)).not.toBeNull();

    const listener = vi.fn();
    window.addEventListener("storage", listener);
    setExportJobId(null);
    window.removeEventListener("storage", listener);

    expect(window.localStorage.getItem(LS_KEY)).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    const evt = listener.mock.calls[0]![0] as StorageEvent;
    expect(evt.key).toBe(LS_KEY);
    expect(evt.newValue).toBeNull();
  });

  it("dispatches a synthetic storage event on set so same-tab listeners see it", () => {
    const listener = vi.fn();
    window.addEventListener("storage", listener);
    setExportJobId("job_xyz", "acme-marketing");
    window.removeEventListener("storage", listener);

    expect(listener).toHaveBeenCalledTimes(1);
    const evt = listener.mock.calls[0]![0] as StorageEvent;
    expect(evt.key).toBe(LS_KEY);
    expect(evt.newValue).toBe(JSON.stringify({ slug: "acme-marketing", jobId: "job_xyz" }));
  });

  it("survives a slug switch — the persisted slug is what the toast polls", () => {
    // This is the bug F-D6 fixes: the persisted slug must stick around
    // even if the user navigates somewhere else. We don't render the
    // component, but we can verify the storage contract: writing for
    // workspace A and then reading back never loses the slug.
    setExportJobId("job_a", "workspace-a");
    const fromA = JSON.parse(window.localStorage.getItem(LS_KEY)!);
    expect(fromA.slug).toBe("workspace-a");

    // Even if the user is "looking at" workspace B, the persisted
    // record for the in-flight export is still workspace A.
    expect(JSON.parse(window.localStorage.getItem(LS_KEY)!).slug).toBe("workspace-a");
  });
});
