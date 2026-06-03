"use client";

/**
 * TemplatePicker — the modal shown by every "+ New X" entry point.
 *
 * Design intent
 * -------------
 * The four creation flows (Agent, Flow, Knowledge Base, Channel) all share
 * the same shape: pick a starting point, then open the create-form modal
 * with the payload pre-filled. Before this component each flow either
 * (a) opened straight to a blank modal, or (b) had a bespoke "type picker"
 * card grid. TemplatePicker unifies that — same component, same i18n
 * shape, same keyboard model — so the user feels one studio, not four.
 *
 * Visual contract
 * ---------------
 *   - 3-column grid on desktop, 1-column on mobile.
 *   - The "Blank" card is always first and visually lighter (dashed border,
 *     muted background) so "start from scratch" feels like the safe default.
 *   - Tags render as Compass-style chips, not pills with colors. The point
 *     is orientation, not decoration.
 *   - Esc closes. Click outside closes. Click a card calls onSelect and
 *     closes immediately — no extra confirmation.
 *
 * Why not HeroUI Modal
 * --------------------
 * The codebase doesn't use HeroUI Modal/Drawer anywhere. Every modal is a
 * hand-rolled overlay matching the CommandPalette pattern:
 * `fixed inset-0 z-[60] ... bg-black/60 backdrop-blur-sm`. We follow that
 * convention so the picker feels native to the existing studio.
 */

import { useCallback, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  BookOpen,
  Code2,
  Compass,
  Globe,
  GitPullRequest,
  Hash,
  Headphones,
  Inbox,
  LifeBuoy,
  Mail,
  Megaphone,
  MessageCircle,
  Newspaper,
  ScrollText,
  Sparkles,
  Target,
  Trophy,
  Webhook,
  X,
  type LucideIcon,
} from "lucide-react";

import {
  getTemplatesFor,
  type CompassTemplate,
  type TemplateKind,
  type TemplatePayloadFor,
} from "@/lib/compass/templates";

// -------------------------------------------------------------------------
// Icon resolution — centralized so the registry can stay stringly-typed.
// Adding a new template icon means: import it here, add one line.
// -------------------------------------------------------------------------

const ICON_BY_NAME: Record<string, LucideIcon> = {
  BookOpen,
  Code2,
  Compass,
  Globe,
  GitPullRequest,
  Hash,
  Headphones,
  Inbox,
  LifeBuoy,
  Mail,
  Megaphone,
  MessageCircle,
  Newspaper,
  ScrollText,
  Sparkles,
  Target,
  Trophy,
  Webhook,
};

function resolveIcon(name: string): LucideIcon {
  return ICON_BY_NAME[name] ?? Sparkles;
}

// -------------------------------------------------------------------------
// Component
// -------------------------------------------------------------------------

interface TemplatePickerProps<K extends TemplateKind> {
  kind: K;
  isOpen: boolean;
  onClose: () => void;
  onSelect: (template: CompassTemplate<TemplatePayloadFor<K>>) => void;
}

export function TemplatePicker<K extends TemplateKind>({
  kind,
  isOpen,
  onClose,
  onSelect,
}: TemplatePickerProps<K>) {
  // Translator scoped to the kind so card lookups stay terse.
  const t = useTranslations(`compass.templates.${kind}`);
  const tShell = useTranslations("compass.templates.shell");

  const templates = useMemo(() => getTemplatesFor(kind), [kind]);

  // Esc closes — same convention as CommandPalette.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const handlePick = useCallback(
    (template: CompassTemplate<TemplatePayloadFor<K>>) => {
      onSelect(template);
      onClose();
    },
    [onSelect, onClose]
  );

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`template-picker-title-${kind}`}
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-4 pt-[10vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <h2
              id={`template-picker-title-${kind}`}
              className="text-base font-semibold text-strong"
            >
              {tShell(`title.${kind}`)}
            </h2>
            <p className="mt-1 text-sm text-muted">{tShell(`subtitle.${kind}`)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tShell("close")}
            className="rounded-md p-1.5 text-muted transition-colors hover:bg-elevated hover:text-strong"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {templates.map((template) => {
              const Icon = resolveIcon(template.iconName);
              const tags = template.tagsKey ? safeArray(t.raw(template.tagsKey)) : [];
              return (
                <li key={template.id}>
                  <button
                    type="button"
                    onClick={() => handlePick(template)}
                    className={[
                      "flex h-full w-full flex-col items-start gap-2 rounded-lg border p-4 text-left transition-all",
                      "hover:border-strong hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                      template.blank
                        ? "border-dashed border-line/70 bg-transparent text-muted hover:text-strong"
                        : "border-line bg-elevated/40",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "flex h-8 w-8 items-center justify-center rounded-md",
                        template.blank ? "bg-transparent text-muted" : "bg-accent/10 text-accent",
                      ].join(" ")}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="text-sm font-semibold text-strong">
                      {t(template.labelKey)}
                    </span>
                    <span className="text-xs leading-relaxed text-muted">
                      {t(template.descriptionKey)}
                    </span>
                    {tags.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] text-muted"
                          >
                            {tag}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <footer className="flex items-center justify-between border-t border-line px-6 py-3 text-xs text-muted">
          <span>{tShell("footerHint")}</span>
          {/* Placeholder for the future template browser. */}
          <a href="#" className="text-strong underline-offset-2 hover:underline">
            {tShell("allTemplates")}
          </a>
        </footer>
      </div>
    </div>
  );
}

/** Coerce an `t.raw()` lookup into a string array; tolerant to misconfig. */
function safeArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return [];
}
