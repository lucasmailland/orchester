/**
 * @vitest-environment jsdom
 */
import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// next-intl is not exercised by anything we assert on; the registry
// surface is the contract. Stub `useTranslations` to a passthrough so
// the component can mount without a NextIntlClientProvider wrapper.
// Mirrors the pattern in TourProvider.test.tsx.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import {
  TourSpot,
  __resetTourSpotRegistryForTests,
  getTourSpot,
  getTourSpots,
  subscribeTourSpots,
} from "./TourSpot";

afterEach(() => {
  cleanup();
  __resetTourSpotRegistryForTests();
});

describe("TourSpot", () => {
  it("registers itself with id, step, title, body", () => {
    render(
      <TourSpot id="recall" step={2} title="Recall queue" body="Items flagged low confidence.">
        <div>region</div>
      </TourSpot>
    );

    const spot = getTourSpot("recall");
    expect(spot).not.toBeNull();
    expect(spot?.id).toBe("recall");
    expect(spot?.step).toBe(2);
    expect(spot?.title).toBe("Recall queue");
    expect(spot?.body).toBe("Items flagged low confidence.");
    expect(typeof spot?.getRect).toBe("function");
  });

  it("unregisters on unmount", () => {
    const { unmount } = render(
      <TourSpot id="x" step={1} title="t" body="b">
        <div />
      </TourSpot>
    );
    expect(getTourSpot("x")).not.toBeNull();
    unmount();
    expect(getTourSpot("x")).toBeNull();
  });

  it("returns spots sorted by step", () => {
    render(
      <>
        <TourSpot id="c" step={3} title="C" body="">
          <div />
        </TourSpot>
        <TourSpot id="a" step={1} title="A" body="">
          <div />
        </TourSpot>
        <TourSpot id="b" step={2} title="B" body="">
          <div />
        </TourSpot>
      </>
    );

    expect(getTourSpots().map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("notifies subscribers when entries change", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTourSpots(listener);

    const { unmount } = render(
      <TourSpot id="x" step={1} title="t" body="b">
        <div />
      </TourSpot>
    );
    expect(listener).toHaveBeenCalled();
    const lastSnapshot = listener.mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(lastSnapshot.map((s) => s.id)).toEqual(["x"]);

    listener.mockClear();
    unmount();
    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls.at(-1)?.[0]).toEqual([]);

    unsubscribe();
  });

  it("injects data-compass-spot on a single intrinsic-element child (no extra wrapper)", () => {
    const { container } = render(
      <TourSpot id="brain" step={1} title="Brain" body="">
        <section data-testid="region">hello</section>
      </TourSpot>
    );

    const section = container.querySelector("section");
    expect(section).not.toBeNull();
    expect(section?.getAttribute("data-compass-spot")).toBe("brain");
    // No span wrapper introduced.
    expect(container.querySelector("span[data-compass-spot]")).toBeNull();
  });

  it("falls back to display:contents wrapper for non-element children", () => {
    const { container } = render(
      <TourSpot id="text" step={1} title="t" body="">
        plain text
      </TourSpot>
    );

    const wrapper = container.querySelector<HTMLElement>('[data-compass-spot="text"]');
    expect(wrapper?.tagName).toBe("SPAN");
    expect(wrapper?.style.display).toBe("contents");
  });

  it("last mounted spot wins when two share an id (route-transition safety)", () => {
    const { rerender } = render(
      <>
        <TourSpot id="dup" step={1} title="first" body="">
          <div />
        </TourSpot>
        <TourSpot id="dup" step={1} title="second" body="">
          <div />
        </TourSpot>
      </>
    );

    expect(getTourSpot("dup")?.title).toBe("second");

    // Remove the second one; registry should NOT be emptied because the first
    // owner check protects us. But since the first never re-registered with the
    // ownership token after being overwritten, the entry is removed when the
    // current owner (second) unmounts. That is the intended behavior — both
    // co-mounted spots are gone, so the registry is empty.
    rerender(<></>);
    expect(getTourSpot("dup")).toBeNull();
  });
});
