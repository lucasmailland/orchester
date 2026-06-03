"use client";

/**
 * ConfirmAction — Compass confirmation dialog with impact preview.
 *
 * Design intent
 * -------------
 * Most confirm dialogs ask "Are you sure?" and leave the user guessing what
 * "sure" actually means. ConfirmAction flips that: it shows the user the
 * concrete impact of the action *before* the confirm button, so the decision
 * is made on evidence, not vibes.
 *
 * Use this when:
 *   - The action is irreversible or expensive (combinar duplicados, recompute
 *     embeddings, publish flow, disconnect provider).
 *   - The user benefits from seeing the scope ("47 registros", "3 agentes
 *     afectados", "12 documentos") before committing.
 *
 * Do NOT use when:
 *   - The action is a trivial, reversible toggle — a tooltip or undoable toast
 *     is enough.
 *   - The impact cannot be summarized in a handful of label/value rows. If
 *     the preview would need its own modal, you probably want a dedicated
 *     review screen, not a confirm dialog.
 *
 * Voice
 * -----
 * All user-facing copy comes through props so the consumer owns i18n. The
 * only hardcoded strings are aria fallbacks. Default button labels are also
 * deferred to the consumer — there is no English literal baked in.
 *
 * Built on top of HeroUI's Modal primitive (the project's primitive layer) and
 * framer-motion for the impact-row stagger. Tokens follow the
 * bg-surface / border-line / text-strong system; no zinc-900 hardcodes.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Button } from "@heroui/react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";

import { APPLE_EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface ConfirmActionImpact {
  /** Human label for the row — comes from i18n via the consumer. */
  label: string;
  /** Formatted value (already localized — numbers, durations, etc.). */
  value: string;
}

export interface ConfirmActionProps {
  /** Controls visibility. The modal is fully controlled. */
  open: boolean;
  /** Called when the user dismisses (Esc, backdrop, cancel button). */
  onClose: () => void;
  /** Dialog heading. Consumer owns the string. */
  title: string;
  /**
   * Optional short paragraph rendered under the title and above the impact
   * preview. Use it to explain *why* this action matters in one sentence.
   * Accepts ReactNode so consumers can embed a `<TermDef>` around jargon.
   */
  description?: ReactNode;
  /**
   * Label for the primary confirm button — typically the verb of the action
   * ("Combinar duplicados", "Publicar flujo"). Consumer owns the string.
   */
  action: string;
  /** Optional secondary/cancel button label. Consumer owns the string. */
  cancelLabel?: string;
  /**
   * The impact rows. Rendered in order, always above the confirm button so
   * the user sees the scope of the action before committing. Empty array is
   * allowed (the section collapses gracefully) but discouraged — if there is
   * no impact preview, prefer the imperative `confirm()` helper instead.
   */
  impact: ReadonlyArray<ConfirmActionImpact>;
  /** Visual treatment for the confirm button. Defaults to neutral. */
  tone?: "neutral" | "destructive";
  /**
   * When true, the confirm button shows a loading state and both buttons are
   * disabled. The dialog stays open until the consumer flips this back and
   * either closes (success) or surfaces an error.
   */
  isPending?: boolean;
  /**
   * Fired when the user activates the primary action. Can be sync or async;
   * the dialog does NOT auto-close — the consumer is responsible for closing
   * after the operation resolves so failures can keep the dialog open.
   */
  onConfirm: () => void | Promise<void>;
  /**
   * Optional aria-label for the confirm button when the visible label is an
   * icon-only or otherwise ambiguous string. Most consumers can leave this.
   */
  confirmAriaLabel?: string;
}

// ---- impl ------------------------------------------------------------------

// Hardcoded aria fallbacks ONLY. No user-visible copy lives in this file.
const ARIA_CLOSE_FALLBACK = "Close";

export function ConfirmAction({
  open,
  onClose,
  title,
  description,
  action,
  cancelLabel,
  impact,
  tone = "neutral",
  isPending = false,
  onConfirm,
  confirmAriaLabel,
}: ConfirmActionProps): ReactNode {
  const titleId = useId();
  const descId = useId();
  const impactId = useId();

  // Track whether onConfirm is mid-flight when the consumer hasn't passed
  // isPending. This lets a sync onConfirm that returns a Promise still get
  // the loading affordance without any extra wiring.
  const [internalPending, setInternalPending] = useState(false);
  const pending = isPending || internalPending;

  // Park focus on the confirm button when the dialog opens so Enter confirms.
  // HeroUI's Modal handles focus trap + restore, but the default focus target
  // would be Cancel (first focusable). We want the destructive/primary verb
  // to be the keyboard-default ONLY for neutral tone — for destructive we
  // intentionally focus Cancel so a careless Enter never destroys data.
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Defer to next tick so HeroUI's own focus management runs first.
    const t = window.setTimeout(() => {
      if (tone === "destructive") {
        cancelRef.current?.focus();
      } else {
        confirmRef.current?.focus();
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [open, tone]);

  async function handleConfirm() {
    if (pending) return;
    try {
      const result = onConfirm();
      if (result instanceof Promise) {
        setInternalPending(true);
        await result;
      }
    } finally {
      setInternalPending(false);
    }
  }

  const confirmColor: "danger" | "primary" = tone === "destructive" ? "danger" : "primary";

  return (
    <Modal
      isOpen={open}
      onClose={() => {
        if (pending) return;
        onClose();
      }}
      // Keyboard parity: Esc closes (HeroUI default), Tab cycles within trap,
      // Enter confirms via the focused primary button.
      isDismissable={!pending}
      hideCloseButton={false}
      backdrop="blur"
      size="md"
      placement="center"
      aria-labelledby={titleId}
      aria-describedby={description ? descId : impact.length > 0 ? impactId : undefined}
      classNames={{
        base: "bg-surface border border-line",
        header: "border-b border-line",
        footer: "border-t border-line",
        closeButton: "text-muted hover:text-body hover:bg-hover",
      }}
      motionProps={{
        variants: {
          enter: {
            opacity: 1,
            scale: 1,
            y: 0,
            transition: { duration: 0.18, ease: APPLE_EASE },
          },
          exit: {
            opacity: 0,
            scale: 0.96,
            y: 6,
            transition: { duration: 0.15, ease: APPLE_EASE },
          },
        },
      }}
    >
      <ModalContent>
        {(closeFromHeroUI) => (
          <>
            <ModalHeader className="flex items-start gap-3 px-5 pb-3 pt-5">
              {tone === "destructive" && (
                <div
                  className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500/15 text-red-600 dark:text-red-400"
                  aria-hidden="true"
                >
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="text-base font-semibold leading-tight text-strong">
                  {title}
                </h2>
                {description && (
                  <p id={descId} className="mt-1.5 text-xs leading-relaxed text-muted">
                    {description}
                  </p>
                )}
              </div>
            </ModalHeader>

            <ModalBody className="px-5 pb-4 pt-1">
              {impact.length > 0 && <ImpactPreview id={impactId} rows={impact} open={open} />}
            </ModalBody>

            <ModalFooter className="flex justify-end gap-2 px-5 py-3">
              <Button
                ref={cancelRef}
                variant="light"
                size="sm"
                isDisabled={pending}
                onPress={() => {
                  closeFromHeroUI();
                  onClose();
                }}
                className="text-muted hover:text-body"
              >
                {cancelLabel ?? ARIA_CLOSE_FALLBACK}
              </Button>
              <Button
                ref={confirmRef}
                color={confirmColor}
                variant="solid"
                size="sm"
                isLoading={pending}
                isDisabled={pending}
                onPress={handleConfirm}
                aria-label={confirmAriaLabel ?? action}
                className="font-medium"
              >
                {action}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

// ---- impact preview --------------------------------------------------------

interface ImpactPreviewProps {
  id: string;
  rows: ReadonlyArray<ConfirmActionImpact>;
  open: boolean;
}

function ImpactPreview({ id, rows, open }: ImpactPreviewProps): ReactNode {
  return (
    <section
      id={id}
      // role=group + aria-label is omitted intentionally: the rows are wired
      // into aria-describedby on the dialog, so the whole block is announced
      // as the description. A separate region would create double-announce.
      className={cn("rounded-xl border border-line bg-elevated/60", "divide-y divide-line/70")}
    >
      <AnimatePresence initial={false}>
        {open && (
          <motion.dl
            className="divide-y divide-line/70"
            initial="hidden"
            animate="visible"
            variants={{
              hidden: { opacity: 0 },
              visible: {
                opacity: 1,
                transition: { staggerChildren: 0.04, delayChildren: 0.05 },
              },
            }}
          >
            {rows.map((row, idx) => (
              <motion.div
                key={`${row.label}-${idx}`}
                variants={{
                  hidden: { opacity: 0, y: 4 },
                  visible: {
                    opacity: 1,
                    y: 0,
                    transition: { duration: 0.18, ease: APPLE_EASE },
                  },
                }}
                className="flex items-center justify-between gap-4 px-3.5 py-2.5"
              >
                <dt className="truncate text-xs text-muted">{row.label}</dt>
                <dd className="shrink-0 text-xs font-medium tabular-nums text-strong">
                  {row.value}
                </dd>
              </motion.div>
            ))}
          </motion.dl>
        )}
      </AnimatePresence>
    </section>
  );
}

export default ConfirmAction;
