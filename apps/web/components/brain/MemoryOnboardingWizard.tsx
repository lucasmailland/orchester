"use client";

/**
 * MemoryOnboardingWizard — 3-step intro modal shown the first time an
 * operator lands on /brain.
 *
 * Why a wizard at all
 * -------------------
 * Brain Inspector is dense (KPI strip, fact list, 9 header buttons).
 * Operators consistently asked "is this manual? do I press something?"
 * — when in fact Mnemosyne extracts facts automatically after every
 * conversation. Three slides answer that without requiring docs:
 *   1. Conversations happen
 *   2. Memory learns automatically (← the load-bearing one)
 *   3. You curate, optionally
 *
 * Persistence
 *  - We mark "seen" in localStorage under a versioned key. Bumping the
 *    `WIZARD_VERSION` constant resets it for everyone — useful when
 *    the copy changes substantially.
 *  - SSR-safe: nothing reads localStorage during render. The "show?"
 *    decision happens in `useEffect` after mount.
 *
 * Trigger
 *  - Auto-opens on first /brain visit (unmarked + mounted).
 *  - Also openable via `?onboarding=1` query param (deep-link from the
 *    "How memory works" link inside the empty state).
 *  - "Skip" / closing-X / "Start" all mark seen — there's no way to
 *    leave the wizard half-finished and have it re-appear next time.
 *
 * Voice
 *  - Compass voice: clear, professional, friendly. No slang, no
 *    "tipo" / "atenti". "Tú" in Spanish neutral; cedilla "você" in pt.
 *  - Copy lives entirely in i18n (`brain.onboarding`).
 */

import { useEffect, useState, type JSX, type ReactNode } from "react";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button } from "@heroui/react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { MessagesSquare, BrainCircuit, ListChecks, ArrowRight, ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const WIZARD_VERSION = 1;
const STORAGE_KEY = `orchester:brain:onboarding:seen:v${WIZARD_VERSION}`;
const TOTAL_STEPS = 3;

interface Step {
  /** i18n sub-namespace under `brain.onboarding.stepN` */
  index: 0 | 1 | 2;
  icon: ReactNode;
  /** Tailwind classes for the icon tile gradient — mirrors EmptyState. */
  tileClass: string;
}

const STEPS: Step[] = [
  {
    index: 0,
    icon: <MessagesSquare className="h-6 w-6" aria-hidden="true" />,
    tileClass: "from-cyan-500 to-blue-500",
  },
  {
    index: 1,
    icon: <BrainCircuit className="h-6 w-6" aria-hidden="true" />,
    tileClass: "from-violet-500 to-fuchsia-500",
  },
  {
    index: 2,
    icon: <ListChecks className="h-6 w-6" aria-hidden="true" />,
    tileClass: "from-emerald-500 to-teal-500",
  },
];

interface MemoryOnboardingWizardProps {
  /**
   * Optional override — when true the wizard opens regardless of the
   * `seen` flag. Useful for a future "Re-take the tour" button.
   */
  forceOpen?: boolean;
  /** Called whenever the user dismisses the wizard (any method). */
  onClose?: () => void;
}

/**
 * Read the seen flag from localStorage. Returns false on SSR or when
 * storage is unavailable — both are fine for first-render safety.
 */
function readSeen(): boolean {
  if (typeof window === "undefined") return true; // SSR: treat as seen so we don't pop a modal during hydration
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Private mode / disabled storage — fail open, operator just
    // re-sees the wizard next time. Not catastrophic.
  }
}

export function MemoryOnboardingWizard({
  forceOpen = false,
  onClose,
}: MemoryOnboardingWizardProps): JSX.Element | null {
  const t = useTranslations("brain.onboarding");
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<0 | 1 | 2>(0);

  // Auto-open on first visit OR when `forceOpen` flips on.
  useEffect(() => {
    setMounted(true);
    if (forceOpen) {
      setOpen(true);
      setStep(0);
      return;
    }
    const seen = readSeen();
    // Also honor a `?onboarding=1` query param so the empty state can
    // deep-link the operator straight into the wizard ("How does
    // memory work?" link).
    let queryAsk = false;
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      queryAsk = params.get("onboarding") === "1";
    }
    if (!seen || queryAsk) {
      setOpen(true);
      setStep(0);
    }
  }, [forceOpen]);

  function close(): void {
    markSeen();
    setOpen(false);
    setStep(0);
    onClose?.();
  }

  function goNext(): void {
    if (step === TOTAL_STEPS - 1) {
      close();
      return;
    }
    setStep((s) => (s + 1) as 0 | 1 | 2);
  }

  function goBack(): void {
    setStep((s) => Math.max(0, s - 1) as 0 | 1 | 2);
  }

  if (!mounted) return null;

  const currentStep = STEPS[step]!;
  const stepKey = `step${step + 1}` as const;
  const isLast = step === TOTAL_STEPS - 1;

  return (
    <Modal
      isOpen={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      placement="center"
      backdrop="blur"
      size="lg"
      hideCloseButton={false}
      classNames={{
        base: "max-w-[520px]",
      }}
    >
      <ModalContent>
        {(onCloseFn) => (
          <>
            <ModalHeader className="flex flex-col gap-1 px-6 pt-6">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-500">
                {t("stepCounter", { current: step + 1, total: TOTAL_STEPS })}
              </span>
              <h2 className="font-display text-xl font-bold tracking-tight text-strong">
                {t("title")}
              </h2>
              <p className="text-sm text-muted">{t("subtitle")}</p>
            </ModalHeader>

            <ModalBody className="px-6 py-4">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={step}
                  initial={reduceMotion ? false : { opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -16 }}
                  transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
                  className="flex flex-col items-start gap-4"
                >
                  <div
                    className={cn(
                      "inline-flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-lg shadow-violet-500/10",
                      "bg-gradient-to-br",
                      currentStep.tileClass
                    )}
                    aria-hidden="true"
                  >
                    {currentStep.icon}
                  </div>

                  <div className="space-y-2">
                    <span className="inline-flex items-center rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-300">
                      {t(`${stepKey}.badge`)}
                    </span>
                    <h3 className="font-display text-lg font-semibold tracking-tight text-strong">
                      {t(`${stepKey}.title`)}
                    </h3>
                    <p className="text-sm leading-relaxed text-muted">{t(`${stepKey}.body`)}</p>
                  </div>

                  {/* Tiny dot pager — also tappable for skip-ahead */}
                  <div className="flex items-center gap-1.5 pt-2" role="tablist">
                    {STEPS.map((s, i) => (
                      <button
                        key={s.index}
                        type="button"
                        role="tab"
                        aria-selected={i === step}
                        aria-label={t("stepCounter", { current: i + 1, total: TOTAL_STEPS })}
                        onClick={() => setStep(i as 0 | 1 | 2)}
                        className={cn(
                          "h-1.5 rounded-full transition-all",
                          i === step
                            ? "w-8 bg-gradient-to-r from-violet-500 to-blue-500"
                            : "w-2 bg-line hover:bg-muted"
                        )}
                      />
                    ))}
                  </div>
                </motion.div>
              </AnimatePresence>
            </ModalBody>

            <ModalFooter className="px-6 pb-6 pt-2">
              <Button
                variant="light"
                size="sm"
                onPress={() => {
                  onCloseFn();
                  close();
                }}
              >
                {t("skip")}
              </Button>
              <div className="ml-auto flex items-center gap-2">
                {step > 0 ? (
                  <Button
                    variant="bordered"
                    size="sm"
                    onPress={goBack}
                    startContent={<ArrowLeft size={14} aria-hidden="true" />}
                  >
                    {t("back")}
                  </Button>
                ) : null}
                <Button
                  color="primary"
                  size="sm"
                  onPress={goNext}
                  endContent={!isLast ? <ArrowRight size={14} aria-hidden="true" /> : null}
                  className="bg-gradient-to-r from-violet-600 to-blue-600 font-semibold text-white"
                >
                  {isLast ? t("start") : t("next")}
                </Button>
              </div>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

export default MemoryOnboardingWizard;
