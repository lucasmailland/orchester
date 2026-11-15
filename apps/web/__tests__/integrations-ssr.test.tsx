import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (k: string) => k;
    t.rich = (k: string) => k;
    return t;
  },
}));
vi.stubGlobal(
  "fetch",
  vi.fn(() => new Promise(() => {}))
); // never resolves

import { IntegrationsClient } from "@/components/integrations/IntegrationsClient";

it("renders the SSR catalog without waiting for /api/integrations", () => {
  render(
    <IntegrationsClient
      initialData={{
        catalog: [
          {
            id: "stripe",
            name: "Stripe",
            description: "Payments",
            category: "billing",
            authType: "apikey",
            needsOAuthApp: false,
            fields: [],
            actions: [],
          },
        ],
        configured: [],
      }}
    />
  );
  expect(screen.getByText("Stripe")).toBeInTheDocument();
});
