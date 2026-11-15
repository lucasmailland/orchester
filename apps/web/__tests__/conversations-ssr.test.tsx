import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ locale: "es", workspaceSlug: "acme-inc" }),
}));
// fetch never resolves → proves the first paint comes from fallbackData.
vi.stubGlobal(
  "fetch",
  vi.fn(() => new Promise(() => {}))
);

import { ConversationsClient } from "@/components/conversations/ConversationsClient";

it("paints rows from SSR fallbackData without waiting for fetch", () => {
  render(
    <ConversationsClient
      agents={[]}
      labels={[]}
      initialData={{
        rows: [
          {
            id: "c1",
            status: "open",
            channelType: "web",
            channelName: null,
            agentId: null,
            agentName: null,
            employeeName: null,
            employeeEmail: null,
            customerName: "Ada",
            customerEmail: null,
            tags: null,
            csat: null,
            messageCount: 2,
            startedAt: new Date().toISOString(),
            takenOverAt: null,
            summary: null,
            totalCostUsd: null,
            totalTokens: null,
          },
        ],
        hasMore: false,
        nextOffset: null,
      }}
    />
  );
  expect(screen.getByText("Ada")).toBeInTheDocument();
});
