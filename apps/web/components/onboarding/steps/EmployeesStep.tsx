"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@heroui/react";
import { useTranslations } from "next-intl";
import { Upload, CheckCircle, SkipForward } from "lucide-react";
import confetti from "canvas-confetti";
import { staggerContainer, staggerItem, APPLE_EASE } from "@/lib/motion";

interface EmployeesStepProps {
  onComplete: () => void;
  isLoading: boolean;
}

export function EmployeesStep({ onComplete, isLoading }: EmployeesStepProps) {
  const t = useTranslations("onboarding.step4");
  const [completed, setCompleted] = useState(false);

  async function handleComplete() {
    confetti({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.6 },
      colors: ["#3B3BFF", "#7C3AED", "#22C55E", "#F59E0B", "#ffffff"],
    });

    setCompleted(true);
    await new Promise((r) => setTimeout(r, 800));
    onComplete();
  }

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <motion.div variants={staggerItem}>
        <h2 className="text-xl font-bold text-default-900 dark:text-default-100">
          {t("title")}
        </h2>
        <p className="mt-1 text-sm text-default-500">{t("description")}</p>
      </motion.div>

      <motion.div variants={staggerItem}>
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-default-200 bg-default-50/50 p-12 dark:border-white/10 dark:bg-white/[0.02]">
          <div className="rounded-2xl bg-fichap-primary/10 p-4 text-fichap-primary">
            <Upload size={28} />
          </div>
          <div className="space-y-1 text-center">
            <p className="text-sm font-medium text-default-700 dark:text-default-200">
              Drop your CSV here
            </p>
            <p className="text-xs text-default-400">
              name, email, phone, area, manager — headers auto-detected
            </p>
          </div>
          <Button variant="flat" size="sm">
            {t("importCsv")}
          </Button>
        </div>
      </motion.div>

      <motion.div variants={staggerItem} className="flex flex-col gap-3">
        <AnimatePresence mode="wait">
          {!completed ? (
            <motion.div
              key="actions"
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: APPLE_EASE }}
              className="flex gap-3"
            >
              <Button
                color="primary"
                className="flex-1 bg-[#3B3BFF] font-semibold"
                isLoading={isLoading}
                onPress={handleComplete}
              >
                {isLoading ? t("finishing") : `${t("allDone")} 🎉`}
              </Button>
              <Button variant="flat" onPress={handleComplete} startContent={<SkipForward size={15} />}>
                {t("skipForNow")}
              </Button>
            </motion.div>
          ) : (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center justify-center gap-2 rounded-xl bg-success/10 p-4 text-success"
            >
              <CheckCircle size={20} />
              <span className="font-medium">{t("allDone")}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
