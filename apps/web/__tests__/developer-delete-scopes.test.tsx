import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import pt from "@/messages/pt.json";
import { DevelopersSection } from "@/components/settings/DevelopersSection";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it.each([en, es, pt])("translates teams and destructive access", (messages) => {
  const labels = messages.pages.settings.developers;
  expect(labels.scopeDomain).toHaveProperty("teams");
  expect(labels.scopeAccess).toHaveProperty("delete");
});
it("offers dangerous delete scopes without granting them when write is selected", async () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => [] }));
  vi.stubGlobal("fetch", fetch);
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{ pages: { settings: { developers: en.pages.settings.developers } } }}
    >
      <DevelopersSection />
    </NextIntlClientProvider>
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  const deletes = screen.getAllByRole("button", { name: /Delete/ });
  expect(deletes).toHaveLength(7);
  expect(deletes[0]).toHaveClass("text-red-700");
  expect(deletes.every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
  fireEvent.click(
    screen.getAllByRole("button", { name: en.pages.settings.developers.scopeAccess.write })[0]!
  );
  expect(deletes.every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
  fireEvent.click(deletes[0]!);
  expect(deletes[0]).toHaveAttribute("aria-pressed", "true");
});
