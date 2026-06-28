"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { APPLE_EASE } from "@/lib/motion";
import { Stepper } from "./Stepper";
import { WelcomeStep } from "./WelcomeStep";
import { ProviderStep } from "./ProviderStep";
import { AgentStep } from "./AgentStep";
import { TalkStep } from "./TalkStep";
import { DoneStep } from "./DoneStep";
import {
  STORAGE_KEYS,
  emitActivation,
  readState,
  writeState,
  type Role,
  type StepIndex,
} from "./types";
import {
  ensureWorkspaceAction,
  getSampleWorkspaceSlugAction,
  markOnboardingComplete,
} from "@/app/actions/first-mile-onboarding";

interface Props {
  locale: string;
  initialStep: number;
  workspaceSlug: string | null;
}

const TOTAL_STEPS = 5;

interface CreatedAgent {
  id: string;
  name: string;
  model: string;
  systemPrompt: string;
  lastReply: string | null;
}

/**
 * Five-step first-mile activation wizard.
 *
 *   0 Welcome    -> pick a role + (optional) sample data
 *   1 Provider   -> connect OpenAI or Anthropic key
 *   2 Agent      -> name + role + template + model
 *   3 Talk       -> send ≥1 message, receive ≥1 reply
 *   4 Done       -> NextStep cards + "Open Studio"
 *
 * Skip-everywhere link in the top right sets `compass.onboarding.skipped`
 * and lands the user in the studio. Refreshing rehydrates step + inputs
 * from localStorage.
 */
export function OnboardingWizard({ locale, initialStep, workspaceSlug }: Props) {
  const t = useTranslations("compass.onboarding");
  const router = useRouter();

  const [step, setStep] = useState<StepIndex>(clamp(initialStep) as StepIndex);
  const [direction, setDirection] = useState(1);
  const [role, setRole] = useState<Role | null>(null);
  const [useSample, setUseSample] = useState(false);
  const [sampleSlug, setSampleSlug] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(workspaceSlug);
  const [agent, setAgent] = useState<CreatedAgent | null>(null);

  const sectionRef = useRef<HTMLDivElement>(null);
  const headingFocusRef = useRef<HTMLDivElement>(null);

  // Hydrate from localStorage (overrides server-suggested initialStep only
  // when it would move us further along).
  useEffect(() => {
    const persisted = readState();
    if (persisted.role) setRole(persisted.role);
    if (typeof persisted.useSample === "boolean") setUseSample(persisted.useSample);
    if (typeof persisted.step === "number") {
      setStep((curr) => (persisted.step! > curr ? (persisted.step as StepIndex) : curr));
    }
  }, []);

  // Detect sample workspace availability for the welcome toggle.
  useEffect(() => {
    void (async () => {
      try {
        const s = await getSampleWorkspaceSlugAction();
        setSampleSlug(s);
      } catch {
        setSampleSlug(null);
      }
    })();
  }, []);

  // Focus management: when step changes, focus the section heading wrapper.
  useEffect(() => {
    headingFocusRef.current?.focus();
  }, [step]);

  // Keyboard nav: left/right arrows move back/forward (forward only when
  // not waiting on user input on the current step — we keep this minimal
  // to avoid stepping past a required interaction).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === "ArrowLeft" && step > 0) {
        e.preventDefault();
        goBack();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const advance = useCallback(
    (next: StepIndex) => {
      setDirection(1);
      setStep(next);
      writeState({ step: next });
      emitActivation(next, slug);
    },
    [slug]
  );

  function goBack() {
    setDirection(-1);
    setStep((s) => (s > 0 ? ((s - 1) as StepIndex) : s));
  }

  async function handleWelcomeNext(values: { role: Role; useSample: boolean }) {
    setRole(values.role);
    setUseSample(values.useSample);
    writeState({ role: values.role, useSample: values.useSample });
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEYS.role, values.role);
    }
    // Ensure a workspace exists before any /api/providers call.
    try {
      if (!slug) {
        const ws = await ensureWorkspaceAction();
        setSlug(ws.slug);
      }
    } catch {
      // If workspace creation fails we still proceed; the provider API
      // will return a 401 the user can act on.
    }
    advance(1);
  }

  function handleProviderConnected() {
    writeState({ providerConnected: true });
    advance(2);
  }

  function handleAgentCreated(a: {
    id: string;
    name: string;
    model: string;
    systemPrompt: string;
  }) {
    setAgent({ ...a, lastReply: null });
    writeState({ agentId: a.id });
    // If the user opted into the sample workspace, AFTER agent creation we
    // redirect to acme-inc and skip the rest.
    if (useSample && sampleSlug) {
      handleSkip(`/${locale}/${sampleSlug}`);
      return;
    }
    advance(3);
  }

  function handleFirstReply(replyText: string) {
    writeState({ conversationStarted: true });
    setAgent((a) => (a ? { ...a, lastReply: a.lastReply ?? replyText } : a));
  }

  function handleTalkContinue() {
    advance(4);
  }

  async function handleOpenStudio() {
    const target = slug ? `/${locale}/${slug}` : `/${locale}`;
    try {
      await markOnboardingComplete();
    } catch {
      // Non-fatal: flag update failure doesn't block studio access.
    }
    router.push(target);
  }

  function handleSkip(targetOverride?: string) {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEYS.skipped, "1");
    }
    const target = targetOverride ?? (slug ? `/${locale}/${slug}` : `/${locale}`);
    router.push(target);
  }

  const stepLabels = useMemo(
    () => [
      t("stepper.welcome"),
      t("stepper.provider"),
      t("stepper.agent"),
      t("stepper.talk"),
      t("stepper.done"),
    ],
    [t]
  );

  const currentNode = (() => {
    switch (step) {
      case 0:
        return (
          <WelcomeStep
            initialRole={role}
            initialUseSample={useSample}
            sampleAvailable={sampleSlug !== null}
            onNext={handleWelcomeNext}
          />
        );
      case 1:
        return <ProviderStep locale={locale} onConnected={handleProviderConnected} />;
      case 2:
        return <AgentStep locale={locale} onCreated={handleAgentCreated} />;
      case 3:
        return agent ? (
          <TalkStep agent={agent} onFirstReply={handleFirstReply} onContinue={handleTalkContinue} />
        ) : (
          // Edge: refresh landed at step 3 but agent state is gone.
          // Send user back to step 2 to rebuild it.
          <AgentStep locale={locale} onCreated={handleAgentCreated} />
        );
      case 4:
        return (
          <DoneStep
            agentName={agent?.name ?? t("done.fallbackAgentName")}
            lastMessage={agent?.lastReply ?? null}
            workspaceSlug={slug}
            locale={locale}
            onOpenStudio={handleOpenStudio}
          />
        );
    }
  })();

  return (
    <div className="flex min-h-screen flex-col bg-app">
      <div className="flex items-center justify-between px-6 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-blue-600">
          <span className="text-sm font-bold text-white">O</span>
        </div>
        <button
          type="button"
          onClick={() => handleSkip()}
          className="text-sm font-medium text-text-muted underline-offset-4 hover:text-text-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600/40 rounded"
        >
          {t("skip")}
        </button>
      </div>

      <div className="mx-auto w-full max-w-lg flex-1 px-4 pb-12">
        <div className="mb-6">
          <Stepper current={step} total={TOTAL_STEPS} labels={stepLabels} />
        </div>

        <div
          ref={sectionRef}
          className="relative overflow-hidden rounded-2xl border border-line bg-card p-6 shadow-sm sm:p-8"
        >
          <div ref={headingFocusRef} tabIndex={-1} aria-live="polite" className="outline-none">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={step}
                custom={direction}
                initial={{ opacity: 0, x: direction > 0 ? 24 : -24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: direction > 0 ? -24 : 24 }}
                transition={{ duration: 0.25, ease: APPLE_EASE }}
              >
                {currentNode}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {step > 0 && step < 4 && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={goBack}
              className="text-xs font-medium text-text-muted hover:text-text-strong"
            >
              {t("back")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function clamp(n: number): number {
  if (n < 0) return 0;
  if (n > TOTAL_STEPS - 1) return TOTAL_STEPS - 1;
  return n;
}
