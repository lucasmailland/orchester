import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { channelConfigSchema } from "@/lib/channels/config";

/**
 * Every channel config field must be settable from the screen.
 *
 * This exists because of a real failure, not a hypothetical one. Three fields
 * were added to `channelConfigSchema` in one day — `allowAnySender`,
 * `allowedGuilds`, `allowedChannels` — and none of them reached
 * `ChannelsClient.tsx`. The consequence was not cosmetic: `allowAnySender`
 * became the only way to open a channel at the same time as an empty list
 * started denying, so the screen could create a channel nobody could ever talk
 * to, with no control to fix it.
 *
 * A field with no screen is a field nobody can set, and the type checker is
 * perfectly happy with it.
 */
const SCREEN = path.join(__dirname, "..", "components", "channels", "ChannelsClient.tsx");

/**
 * Fields that deliberately have no control, each with its reason. Adding to
 * this list is a decision; leaving a field out of both is an oversight, which
 * is the difference this test exists to keep visible.
 */
const WITHOUT_CONTROL: Record<string, string> = {};

describe("the channels screen can set every config field", () => {
  const src = fs.readFileSync(SCREEN, "utf8");
  const fields = Object.keys(channelConfigSchema.shape);

  it("the schema has fields to check, so a rename cannot silently empty this test", () => {
    // Without this, `shape` returning {} after a refactor would make every
    // assertion below vacuously pass — a green test measuring nothing.
    expect(fields.length).toBeGreaterThanOrEqual(5);
  });

  it.each(Object.keys(channelConfigSchema.shape))("%s is reachable from the screen", (field) => {
    if (field in WITHOUT_CONTROL) return;
    expect(src, `${field} is in channelConfigSchema and in no control`).toContain(field);
  });

  it("every exemption names a field that still exists", () => {
    // An exemption for a deleted field is a comment pretending to be a rule.
    for (const field of Object.keys(WITHOUT_CONTROL)) {
      expect(fields, `${field} is exempted but no longer in the schema`).toContain(field);
    }
  });
});

/**
 * next-intl throws at render for a missing key, so a string added only to `en`
 * blanks the screen for a Spanish or Portuguese operator.
 */
describe("the channels strings exist in every locale", () => {
  const dir = path.join(__dirname, "..", "messages");
  const loadMessages = (loc: string) =>
    JSON.parse(fs.readFileSync(path.join(dir, `${loc}.json`), "utf8")).pages.channels as Record<
      string,
      unknown
    >;

  /**
   * Flattens to `a.b.c` paths. The namespace is not flat — `types` is a nested
   * group — so comparing only the top level would miss a label added inside it
   * in one language and not the others.
   */
  function leafStrings(o: unknown, prefix = ""): Map<string, string> {
    const result = new Map<string, string>();
    if (typeof o === "string") {
      result.set(prefix, o);
    } else if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        for (const [kk, vv] of leafStrings(v, prefix ? `${prefix}.${k}` : k)) result.set(kk, vv);
      }
    }
    return result;
  }

  const en = leafStrings(loadMessages("en"));

  it.each(["es", "pt"])("%s has the same keys as en, none empty", (loc) => {
    const other = leafStrings(loadMessages(loc));
    expect([...other.keys()].sort()).toEqual([...en.keys()].sort());
    for (const [k, v] of other) {
      expect(v.trim().length, `${loc}.pages.channels.${k} is empty`).toBeGreaterThan(0);
    }
  });

  it("does not still tell the operator that an empty list allows everyone", () => {
    // The old help text said exactly that. After the gate changed it was the
    // opposite of the truth, which is worse than saying nothing: the screen
    // was actively teaching the wrong model.
    for (const loc of ["en", "es", "pt"]) {
      const help = (loadMessages(loc)["allowlistHelp"] as string) ?? "";
      expect(help.toLowerCase(), `${loc} allowlistHelp`).not.toMatch(
        /allows everyone|permite a (todos|cualquiera)|permite todos/
      );
    }
  });
});
