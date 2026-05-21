"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Button, Input, Chip } from "@heroui/react";
import { useTranslations } from "next-intl";
import { Key, Zap, SkipForward } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";

const apiKeySchema = z.object({
  anthropicKey: z.string().optional(),
});

export type ApiKeyValues = z.infer<typeof apiKeySchema>;

interface ApiKeyStepProps {
  onNext: (values: ApiKeyValues) => void;
  onSkip: () => void;
  submitButton: React.ReactNode;
}

export function ApiKeyStep({ onNext, onSkip, submitButton }: ApiKeyStepProps) {
  const t = useTranslations("onboarding.step2");
  const { register, handleSubmit } = useForm<ApiKeyValues>({
    resolver: zodResolver(apiKeySchema),
  });

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <motion.div variants={staggerItem} className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-fichap-accent/10">
          <Zap size={24} className="text-fichap-accent" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">
            {t("title")}
          </h2>
          <p className="text-sm text-default-500">{t("description")}</p>
        </div>
      </motion.div>

      <motion.form
        variants={staggerItem}
        onSubmit={handleSubmit(onNext)}
        className="space-y-4"
        id="onboarding-form"
      >
        <div className="rounded-xl border border-default-100 bg-default-50/50 p-4 dark:border-white/5 dark:bg-white/[0.02]">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-5 w-5 rounded bg-gradient-to-br from-[#CC785C] to-[#C96442]" />
              <span className="text-sm font-medium">Anthropic</span>
            </div>
            <Chip size="sm" color="primary" variant="flat">
              {t("recommended")}
            </Chip>
          </div>
          <Input
            {...register("anthropicKey")}
            type="password"
            label={t("apiKey")}
            labelPlacement="outside"
            placeholder={t("apiKeyPlaceholder")}
            startContent={<Key size={14} className="shrink-0 text-default-400" />}
            classNames={{ inputWrapper: "bg-default-100" }}
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">{submitButton}</div>
          <Button
            type="button"
            variant="flat"
            onPress={onSkip}
            startContent={<SkipForward size={15} />}
          >
            {t("skip")}
          </Button>
        </div>
      </motion.form>
    </motion.div>
  );
}
