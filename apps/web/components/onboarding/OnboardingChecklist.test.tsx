/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { OnboardingChecklist } from "./OnboardingChecklist";

const state = {
  hasAgent: true,
  hasProvider: true,
  hasChannel: true,
  hasTeammate: false,
  hasActivity: true,
};
const KEY = "orchester:onboarding-checklist:dismissed:ws_1";
const mount = (s = state, ws = "ws_1") =>
  render(<OnboardingChecklist state={s} workspaceId={ws} locale="es" workspaceSlug="acme" />);

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("OnboardingChecklist hide button", () => {
  it("shows the card with a hide button while steps are pending", () => {
    mount();
    expect(screen.getByText("title")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "hide" })).toBeInTheDocument();
  });

  it("renders nothing before hydration, so a hidden card never flashes", () => {
    const html = renderToString(
      <OnboardingChecklist state={state} workspaceId="ws_1" locale="es" workspaceSlug="acme" />
    );
    expect(html).toBe("");
  });

  it("hides the card, persists it, and keeps it hidden after a remount", () => {
    const first = mount();
    fireEvent.click(screen.getByRole("button", { name: "hide" }));
    expect(screen.queryByText("title")).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBe("1");
    first.unmount();
    mount();
    expect(screen.queryByText("title")).toBeNull();
  });

  it("does not hide another workspace's card", () => {
    window.localStorage.setItem(KEY, "1");
    mount(state, "ws_2");
    expect(screen.getByText("title")).toBeInTheDocument();
  });

  it("still hides when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "hide" }));
    expect(screen.queryByText("title")).toBeNull();
    vi.restoreAllMocks();
  });
});
