"use client";

/**
 * useTemplateCreateFlow — shared state machine for the four (and counting)
 * "+ New X" entry points that pair a TemplatePicker with a create form.
 *
 * Before this hook, Agents / Flows / Knowledge / Channels each implemented
 * the same picker → form transition with slightly different shapes (a
 * "hidden" | "picker" | "form" union in two places, ad-hoc boolean pairs
 * in the other two). The drift cost: subtle bugs (e.g. picker + form both
 * open at once), no shared way to add a 5th entry point, copy-paste rot.
 *
 * The hook owns three things:
 *   - `phase`: which surface is visible ("hidden" | "picker" | "form").
 *   - `selectedTemplate`: the template the user picked, if any. `null`
 *     means either "no picker has happened yet" or "user clicked Blank".
 *   - the transition functions: openPicker, selectTemplate, openBlankForm,
 *     closeAll.
 *
 * Consumers stay in charge of their own form-field state and submit logic.
 * The hook is intentionally form-agnostic — it just tracks WHICH surface
 * is on screen and WHICH template (if any) seeded it.
 *
 * The `_kind` parameter is reserved for future analytics / per-kind
 * behaviour (e.g. distinct keyboard shortcuts). Today it's a marker only,
 * but keeping it in the signature means we don't break callers when we
 * start using it.
 */

import { useCallback, useState } from "react";

import type { CompassTemplate, TemplateKind } from "./templates";

type Phase = "hidden" | "picker" | "form";

export interface UseTemplateCreateFlowResult<TPayload> {
  /** Which surface is on screen right now. */
  phase: Phase;
  /**
   * The template the user picked, or `null` if they picked Blank / haven't
   * picked anything yet. Use this to seed your form when `phase === "form"`.
   */
  selectedTemplate: CompassTemplate<TPayload> | null;
  /** Open the TemplatePicker. Clears any prior template selection. */
  openPicker: () => void;
  /**
   * The user picked a non-Blank template — transition to the form with that
   * template recorded. The consumer is responsible for treating `blank`
   * templates via `openBlankForm` (or by inspecting `template.blank` first).
   */
  selectTemplate: (template: CompassTemplate<TPayload>) => void;
  /**
   * Skip straight to the form with no template (the "Blank" path). Use this
   * when the user picked the Blank card so the form opens clean.
   */
  openBlankForm: () => void;
  /** Close everything and reset selection. The "Cancel" / "X" handler. */
  closeAll: () => void;
}

export function useTemplateCreateFlow<TPayload = unknown>(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _kind: TemplateKind
): UseTemplateCreateFlowResult<TPayload> {
  const [phase, setPhase] = useState<Phase>("hidden");
  const [selectedTemplate, setSelectedTemplate] = useState<CompassTemplate<TPayload> | null>(null);

  const openPicker = useCallback(() => {
    setSelectedTemplate(null);
    setPhase("picker");
  }, []);

  const selectTemplate = useCallback((template: CompassTemplate<TPayload>) => {
    setSelectedTemplate(template);
    setPhase("form");
  }, []);

  const openBlankForm = useCallback(() => {
    setSelectedTemplate(null);
    setPhase("form");
  }, []);

  const closeAll = useCallback(() => {
    setPhase("hidden");
    setSelectedTemplate(null);
  }, []);

  return { phase, selectedTemplate, openPicker, selectTemplate, openBlankForm, closeAll };
}
