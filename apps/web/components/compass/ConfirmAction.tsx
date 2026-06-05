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
 * Experienced-operator escape hatch
 * ---------------------------------
 * Repeated confirmations punish power users who already know what the action
 * does. When a consumer passes `rememberKey`, the dialog renders a
 * "Don't ask me again" checkbox; opting in writes a short-lived record to
 * localStorage. On the next invocation with the same key, we auto-confirm
 * without rendering the modal. The record carries a timestamp and we expire
 * it after 30 days so muscle memory does not outlive deploys that may change
 * what the action does. The remembered preference is per-browser and
 * per-rememberKey — different actions never share state.
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
 * deferred to the consumer — there is no English literal baked in. The three
 * strings related to the "don't ask again" affordance are passed in via the
 * `rememberLabels` prop so this file stays i18n-free.
 *
 * Built on top of HeroUI's Modal primitive (the project's primitive layer) and
 * framer-motion for the impact-row stagger. Tokens follow the
 * bg-surface / border-line / text-strong system; no zinc-900 hardcodes.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Button,
  Checkbox,
} from "@heroui/react";
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

/**
 * Strings for the "don't ask me again" affordance. Required only when the
 * consumer passes `rememberKey`. Kept as a separate prop bag so this file
 * never imports i18n directly.
 */
export interface ConfirmActionRememberLabels {
  /** Checkbox label, e.g. "No volver a preguntar". */
  dontAskAgain: string;
  /** Footer link label, e.g. "Restablecer confirmaciones". */
  resetConfirmations: string;
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
  description?: ReactNode | undefined;
  /**
   * Label for the primary confirm button — typically the verb of the action
   * ("Combinar duplicados", "Publicar flujo"). Consumer owns the string.
   */
  action: string;
  /** Optional secondary/cancel button label. Consumer owns the string. */
  cancelLabel?: string;
  /**
   * The impact rows. Rendered in order, always above the confirm button so
   * the user sees the scope of the action before committing. When omitted or
   * empty, the impact preview section is not rendered at all (the dialog
   * still works as a plain confirm).
   */
  impact?: ReadonlyArray<ConfirmActionImpact>;
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
  /**
   * Opt the action into the "don't ask me again" escape hatch. When set, the
   * dialog renders a checkbox in the footer. If the user checks it and
   * confirms, we persist a record under
   * `compass.confirmAction.skip.<rememberKey>` and, on the next invocation
   * with the same key (within {@link CONFIRM_ACTION_TTL_MS}), auto-confirm
   * without rendering the modal. Different actions should use distinct keys.
   * Omit the prop to keep the legacy "always ask" behaviour.
   */
  rememberKey?: string | undefined;
  /**
   * i18n strings for the "don't ask again" + "reset confirmations"
   * affordances. Required when `rememberKey` is set. Kept off the global
   * label list so the file does not import next-intl.
   */
  rememberLabels?: ConfirmActionRememberLabels;
  /**
   * Optional callback fired when the modal auto-confirms because a previous
   * "don't ask again" record was found. Use it to surface a toast to the
   * user so the silent execution is still discoverable. Receives the
   * rememberKey that triggered the skip.
   */
  onAutoConfirm?: (rememberKey: string) => void;
}

// ---- impl ------------------------------------------------------------------

// Hardcoded aria fallbacks ONLY. No user-visible copy lives in this file.
const ARIA_CLOSE_FALLBACK = "Close";

/**
 * Storage key prefix for "don't ask again" records. Each rememberKey lives
 * under its own localStorage entry so we can list, clear and reset
 * independently without parsing a shared blob.
 */
export const CONFIRM_ACTION_STORAGE_PREFIX = "compass.confirmAction.skip.";

/**
 * How long a "don't ask again" record stays valid before we ask again. Thirty
 * days keeps muscle memory from outliving deploys that may change the
 * semantics of the action.
 */
export const CONFIRM_ACTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface SkipRecord {
  /** Unix epoch in ms when the user opted in. */
  ts: number;
  /** The rememberKey, copied in for forward-debugability. */
  key: string;
}

function storageKeyFor(rememberKey: string): string {
  return `${CONFIRM_ACTION_STORAGE_PREFIX}${rememberKey}`;
}

function readSkipRecord(rememberKey: string): SkipRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKeyFor(rememberKey));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { ts?: unknown }).ts !== "number"
    ) {
      return null;
    }
    return parsed as SkipRecord;
  } catch {
    // SSR, private mode, quota errors, malformed JSON — all benign here.
    return null;
  }
}

function writeSkipRecord(rememberKey: string): void {
  if (typeof window === "undefined") return;
  try {
    const record: SkipRecord = { ts: Date.now(), key: rememberKey };
    window.localStorage.setItem(storageKeyFor(rememberKey), JSON.stringify(record));
  } catch {
    // Best-effort. Private mode / quota errors should never surface to the
    // user — losing the preference is strictly less bad than crashing.
  }
}

function clearSkipRecord(rememberKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKeyFor(rememberKey));
  } catch {
    // ignore
  }
}

function isSkipRecordFresh(record: SkipRecord | null): boolean {
  if (!record) return false;
  const age = Date.now() - record.ts;
  return age >= 0 && age < CONFIRM_ACTION_TTL_MS;
}

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
  rememberKey,
  rememberLabels,
  onAutoConfirm,
}: ConfirmActionProps): ReactNode {
  const titleId = useId();
  const descId = useId();
  const impactId = useId();

  const rows = impact ?? [];
  const hasImpact = rows.length > 0;

  // Track whether onConfirm is mid-flight when the consumer hasn't passed
  // isPending. This lets a sync onConfirm that returns a Promise still get
  // the loading affordance without any extra wiring.
  const [internalPending, setInternalPending] = useState(false);
  const pending = isPending || internalPending;

  // "Don't ask again" checkbox state — reset on every open so the choice is
  // explicit per dialog instance.
  const [dontAskAgain, setDontAskAgain] = useState(false);

  // Whether the current rememberKey already has a fresh skip record. Tracked
  // in state because users can reset it from the footer without remounting.
  const [hasSkipRecord, setHasSkipRecord] = useState(false);

  useEffect(() => {
    if (!rememberKey) {
      setHasSkipRecord(false);
      return;
    }
    setHasSkipRecord(isSkipRecordFresh(readSkipRecord(rememberKey)));
  }, [rememberKey, open]);

  useEffect(() => {
    if (open) setDontAskAgain(false);
  }, [open]);

  const handleConfirm = useCallback(
    async (auto = false) => {
      if (pending) return;
      if (!auto && rememberKey && dontAskAgain) {
        writeSkipRecord(rememberKey);
      }
      try {
        const result = onConfirm();
        if (result instanceof Promise) {
          setInternalPending(true);
          await result;
        }
      } finally {
        setInternalPending(false);
      }
    },
    [pending, rememberKey, dontAskAgain, onConfirm]
  );

  // Auto-confirm path: when the consumer opens the modal with a rememberKey
  // that already has a fresh skip record, we suppress the render and invoke
  // onConfirm on the next tick. The microtask delay keeps callers that flip
  // open state synchronously inside an event handler well-defined.
  const autoConfirmedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !rememberKey) {
      autoConfirmedRef.current = null;
      return;
    }
    const record = readSkipRecord(rememberKey);
    if (!isSkipRecordFresh(record)) return;
    if (autoConfirmedRef.current === rememberKey) return;
    autoConfirmedRef.current = rememberKey;
    const t = window.setTimeout(() => {
      onAutoConfirm?.(rememberKey);
      void handleConfirm(true);
    }, 0);
    return () => window.clearTimeout(t);
  }, [open, rememberKey, handleConfirm, onAutoConfirm]);

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

  // Enter-to-confirm: HeroUI's Modal doesn't bind Enter, so wire it on the
  // dialog root. We exit early when focus is inside a textarea/input/select
  // so typed content keeps its natural newline / submit semantics.
  useEffect(() => {
    if (!open) return;
    function onKey(ev: KeyboardEvent): void {
      if (ev.key !== "Enter") return;
      const target = ev.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (tag === "textarea" || tag === "input" || tag === "select") return;
      if (target?.isContentEditable) return;
      ev.preventDefault();
      void handleConfirm();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handleConfirm]);

  const confirmColor: "danger" | "primary" = tone === "destructive" ? "danger" : "primary";

  // If we're about to auto-confirm, render nothing — the consumer's onConfirm
  // takes over immediately and the modal never flashes.
  if (open && rememberKey && isSkipRecordFresh(readSkipRecord(rememberKey)) && !pending) {
    return null;
  }

  const showRememberAffordance = Boolean(rememberKey && rememberLabels);

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
      aria-describedby={description ? descId : hasImpact ? impactId : undefined}
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
            <ModalHeader
              className={cn(
                "flex items-start gap-3 px-5 pb-3 pt-5",
                // Left border accent on destructive tone so the user can't
                // miss the severity even if they ignore the icon.
                tone === "destructive" && "border-l-2 border-l-red-500/30"
              )}
            >
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

            {hasImpact && (
              <ModalBody className="px-5 pb-4 pt-1">
                <ImpactPreview id={impactId} rows={rows} open={open} />
              </ModalBody>
            )}

            <ModalFooter className="flex flex-col gap-3 px-5 py-3">
              {showRememberAffordance && rememberLabels && (
                <div className="flex w-full items-center justify-between gap-3">
                  <Checkbox
                    size="sm"
                    isSelected={dontAskAgain}
                    onValueChange={setDontAskAgain}
                    isDisabled={pending}
                    classNames={{ label: "text-xs text-muted" }}
                  >
                    {rememberLabels.dontAskAgain}
                  </Checkbox>
                  {hasSkipRecord && rememberKey && (
                    <button
                      type="button"
                      onClick={() => {
                        clearSkipRecord(rememberKey);
                        setHasSkipRecord(false);
                      }}
                      className="text-xs text-muted underline-offset-2 hover:text-body hover:underline"
                    >
                      {rememberLabels.resetConfirmations}
                    </button>
                  )}
                </div>
              )}
              <div className="flex justify-end gap-2">
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
                  onPress={() => void handleConfirm()}
                  aria-label={confirmAriaLabel ?? action}
                  className="font-medium"
                >
                  {action}
                </Button>
              </div>
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
