import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isProtectedPath } from "../lib/middleware-utils";
import { isNonWorkspaceTopLevel, extractLocaleAndSlug } from "../lib/tenant/middleware";

/**
 * The approval page has to be reachable by someone with no account, because
 * the link arrives by Telegram, Discord or mail and the token is the
 * credential. Two separate mechanisms decide that, and missing either one
 * breaks the page for a *different* half of the audience — which is why both
 * are pinned here.
 */
describe("/aprobar is reachable without a session", () => {
  it("is not a protected path, so no redirect to login", () => {
    expect(isProtectedPath("/aprobar")).toBe(false);
    expect(isProtectedPath("/aprobar/apr_ws_abc.secreto")).toBe(false);
  });

  it("is exempt from the workspace redirect, so a logged-in approver is not bounced", () => {
    // This is the half that is easy to miss: the legacy-redirect in
    // middleware.ts only fires when there IS a session. Without this entry the
    // link works for a stranger and 404s for the team, which is the worst
    // possible way for it to break.
    expect(isNonWorkspaceTopLevel("aprobar")).toBe(true);
  });

  it("is not read as a workspace slug", () => {
    const { locale, slug, rest } = extractLocaleAndSlug("/en/aprobar/apr_ws_abc.secreto");
    expect(locale).toBe("en");
    expect(slug).toBeNull();
    expect(rest).toContain("aprobar");
  });

  it("still protects the paths it should", () => {
    // Guard against someone "fixing" this by widening the exemption.
    expect(isProtectedPath("/flows")).toBe(true);
    expect(isNonWorkspaceTopLevel("flows")).toBe(false);
  });
});

/**
 * next-intl throws at render time for a missing key, so a namespace that
 * exists only in `en` turns the page blank for a Spanish or Portuguese
 * approver — exactly the person most likely to receive the link here. 113 of
 * the app's components read from these catalogs; a missing key is not caught
 * by the type checker.
 */
describe("the approvals namespace is complete in every locale", () => {
  const dir = path.join(__dirname, "..", "messages");
  const cargar = (loc: string) =>
    JSON.parse(fs.readFileSync(path.join(dir, `${loc}.json`), "utf8"));

  const en = cargar("en").approvals as Record<string, string>;

  it("exists in en", () => {
    expect(en).toBeTypeOf("object");
    expect(Object.keys(en).length).toBeGreaterThan(0);
  });

  it.each(["es", "pt"])("%s has the same keys as en, and none empty", (loc) => {
    const otro = cargar(loc).approvals as Record<string, string>;
    expect(otro).toBeTypeOf("object");
    expect(Object.keys(otro).sort()).toEqual(Object.keys(en).sort());
    for (const [k, v] of Object.entries(otro)) {
      expect(typeof v, `${loc}.approvals.${k}`).toBe("string");
      expect(v.trim().length, `${loc}.approvals.${k} is empty`).toBeGreaterThan(0);
    }
  });

  it("covers every key the page and the client actually ask for", () => {
    // A key renamed in the catalog but not in the component fails only when a
    // person opens the page. This reads the two files and checks the calls.
    const archivos = [
      path.join(__dirname, "..", "app", "[locale]", "aprobar", "[token]", "page.tsx"),
      path.join(__dirname, "..", "components", "approvals", "ApprovalClient.tsx"),
    ];
    const usadas = new Set<string>();
    for (const f of archivos) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/\bt\("([A-Za-z0-9_]+)"\)/g)) usadas.add(m[1]!);
    }
    expect(usadas.size).toBeGreaterThan(5);
    expect([...usadas].filter((k) => !(k in en))).toEqual([]);
  });
});
