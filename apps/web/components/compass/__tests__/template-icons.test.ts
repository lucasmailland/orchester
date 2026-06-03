/**
 * Template icon registry — type and runtime guard.
 *
 * Type level: `CompassTemplate.iconName: CompassIconName` and the picker's
 * `ICON_BY_NAME: Record<CompassIconName, LucideIcon>` already make a typo in a
 * template's `iconName` a compile error. This test gives us a runtime mirror
 * in CI so a regression that loosens those types still trips a red light.
 *
 * What we check
 * -------------
 *   1. Every template in every kind (agent | flow | knowledge | channel)
 *      declares a non-empty `iconName` that belongs to the valid set.
 *   2. The valid set is exhaustively listed below — if `CompassIconName`
 *      changes, this list must change too, which forces the author to think
 *      about whether the picker map needs a matching entry.
 */
import { describe, expect, it } from "vitest";

import {
  COMPASS_TEMPLATES,
  type CompassIconName,
  type TemplateKind,
} from "@/lib/compass/templates";

// Mirror of CompassIconName as a runtime Set. Kept in sync intentionally:
// if the union grows, this list must grow too — that diff is the signal.
const VALID_ICON_NAMES = new Set<CompassIconName>([
  "BookOpen",
  "Code2",
  "Compass",
  "Globe",
  "GitPullRequest",
  "Hash",
  "Headphones",
  "Inbox",
  "LifeBuoy",
  "Mail",
  "Megaphone",
  "MessageCircle",
  "Newspaper",
  "ScrollText",
  "Sparkles",
  "Target",
  "Trophy",
  "Webhook",
]);

const KINDS: TemplateKind[] = ["agent", "flow", "knowledge", "channel"];

describe("compass template icon registry", () => {
  for (const kind of KINDS) {
    describe(kind, () => {
      const templates = COMPASS_TEMPLATES[kind];

      it("has at least one template", () => {
        expect(templates.length).toBeGreaterThan(0);
      });

      for (const template of templates) {
        it(`${template.id} declares a valid CompassIconName (${template.iconName})`, () => {
          expect(typeof template.iconName).toBe("string");
          expect(template.iconName.length).toBeGreaterThan(0);
          expect(VALID_ICON_NAMES.has(template.iconName)).toBe(true);
        });
      }
    });
  }
});
