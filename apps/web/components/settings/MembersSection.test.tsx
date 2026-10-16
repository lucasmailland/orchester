/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { MembersSection } from "./MembersSection";

const URL_ = "https://app.example.com/invite/tok";

function mockApi(postBody: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const json = (b: unknown, ok = true) => ({ ok, json: async () => b });
      if (init?.method === "POST") return json(postBody);
      if (url === "/api/workspace-members") return json({ members: [], callerRole: "owner" });
      return json([]);
    })
  );
}

async function invite() {
  render(<MembersSection />);
  const input = await screen.findByPlaceholderText("emailPlaceholder");
  fireEvent.change(input, { target: { value: "a@b.com" } });
  fireEvent.click(screen.getByRole("button", { name: "invite" }));
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MembersSection invite toast", () => {
  it("shows success when the email was sent", async () => {
    mockApi({ inviteUrl: URL_, emailStatus: "sent" });
    await invite();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("inviteSent"));
    expect(toast.warning).not.toHaveBeenCalled();
    expect(await screen.findByText("inviteLinkLabel")).toBeInTheDocument();
  });

  it.each([
    ["not_configured", "inviteEmailNotConfigured"],
    ["failed", "inviteEmailFailed"],
  ])("warns and keeps the link visible when emailStatus is %s", async (status, key) => {
    mockApi({ inviteUrl: URL_, emailStatus: status });
    await invite();
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(key));
    expect(toast.success).not.toHaveBeenCalled();
    expect(await screen.findByText(URL_)).toBeInTheDocument();
    // The label must not claim the link went out by email.
    expect(screen.getByText("inviteLinkLabelNotSent")).toBeInTheDocument();
    expect(screen.queryByText("inviteLinkLabel")).toBeNull();
  });
});
