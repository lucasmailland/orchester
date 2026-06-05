"use client";

import { useState, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@heroui/react";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { OnboardingProgress } from "./OnboardingProgress";
import { WelcomeStep, type WelcomeValues } from "./steps/WelcomeStep";
import { ApiKeyStep, type ApiKeyValues } from "./steps/ApiKeyStep";
import { TemplateStep } from "./steps/TemplateStep";
import { EmployeesStep } from "./steps/EmployeesStep";
import { createWorkspaceAction, completeOnboardingAction } from "@/app/actions/onboarding";
import { notify } from "@/lib/toast";
import { APPLE_EASE } from "@/lib/motion";

const TOTAL_STEPS = 4;
const STEP_LABELS = ["Workspace", "API Key", "Template", "Employees"];

interface OnboardingWizardProps {
  locale: string;
}

export function OnboardingWizard({ locale }: OnboardingWizardProps) {
  const t = useTranslations("onboarding");
  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [isPending, startTransition] = useTransition();

  // The captured api key values are stored in state for downstream wizard
  // steps; the reader is intentionally unused today (prefix-`_` opts out of
  // the no-unused-vars lint).
  const [_apiKeyData, setApiKeyData] = useState<ApiKeyValues | null>(null);

  function goNext() {
    setDirection(1);
    setCurrentStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }

  function goBack() {
    setDirection(-1);
    setCurrentStep((s) => Math.max(s - 1, 0));
  }

  async function handleWelcomeNext(values: WelcomeValues) {
    try {
      await createWorkspaceAction(values);
      goNext();
    } catch {
      notify.error("Could not create workspace. Try a different slug.");
    }
  }

  function handleApiKeyNext(values: ApiKeyValues) {
    setApiKeyData(values);
    goNext();
  }

  function handleComplete() {
    startTransition(async () => {
      await completeOnboardingAction(locale);
    });
  }

  const continueBtn = (label: string) => (
    <Button
      type="submit"
      form="onboarding-form"
      color="primary"
      className="w-full bg-[#3B3BFF] font-semibold"
      size="lg"
      endContent={<ArrowRight size={16} />}
    >
      {label}
    </Button>
  );

  const steps = [
    <WelcomeStep
      key="welcome"
      onNext={handleWelcomeNext}
      submitButton={continueBtn(t("step1.continue"))}
    />,
    <ApiKeyStep
      key="apikey"
      onNext={handleApiKeyNext}
      onSkip={goNext}
      submitButton={continueBtn(t("step2.continue"))}
    />,
    <TemplateStep key="template" onNext={goNext} onSkip={goNext} />,
    <EmployeesStep key="employees" onComplete={handleComplete} isLoading={isPending} />,
  ];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-lg space-y-8">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-fichap-primary to-fichap-accent">
            <span className="text-sm font-bold text-white">O</span>
          </div>
          <OnboardingProgress
            currentStep={currentStep}
            totalSteps={TOTAL_STEPS}
            stepLabels={STEP_LABELS}
          />
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-default-100 bg-background p-8 shadow-medium dark:border-white/5">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={currentStep}
              custom={direction}
              initial={{ opacity: 0, x: direction > 0 ? 40 : -40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction > 0 ? -40 : 40 }}
              transition={{ duration: 0.3, ease: APPLE_EASE }}
            >
              {steps[currentStep]}
            </motion.div>
          </AnimatePresence>
        </div>

        {currentStep > 0 && currentStep < TOTAL_STEPS - 1 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex justify-center"
          >
            <Button variant="light" size="sm" onPress={goBack}>
              ← Back
            </Button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
