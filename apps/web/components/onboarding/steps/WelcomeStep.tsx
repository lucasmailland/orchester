"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Input } from "@heroui/react";
import { useTranslations } from "next-intl";
import { Building2 } from "lucide-react";
import { generateSlug } from "@/lib/slug";
import { staggerContainer, staggerItem } from "@/lib/motion";

const welcomeSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9-]+$/, "Only lowercase letters, numbers, and hyphens"),
});

export type WelcomeValues = z.infer<typeof welcomeSchema>;

interface WelcomeStepProps {
  onNext: (values: WelcomeValues) => void;
  defaultValues?: Partial<WelcomeValues>;
  submitButton: React.ReactNode;
}

export function WelcomeStep({ onNext, defaultValues, submitButton }: WelcomeStepProps) {
  const t = useTranslations("onboarding.step1");

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<WelcomeValues>({
    resolver: zodResolver(welcomeSchema),
    defaultValues: defaultValues ?? { name: "", slug: "" },
  });

  const nameValue = watch("name");

  useEffect(() => {
    if (nameValue) {
      setValue("slug", generateSlug(nameValue), { shouldValidate: true });
    }
  }, [nameValue, setValue]);

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <motion.div variants={staggerItem} className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-fichap-primary/10">
          <Building2 size={24} className="text-fichap-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-default-900 dark:text-default-100">
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
        <Input
          {...register("name")}
          label={t("workspaceName")}
          placeholder={t("workspaceNamePlaceholder")}
          isInvalid={!!errors.name}
          errorMessage={errors.name?.message}
          classNames={{ inputWrapper: "bg-default-100 dark:bg-default-50/10" }}
          autoFocus
        />
        <Input
          {...register("slug")}
          label={t("workspaceSlug")}
          placeholder="acme-inc"
          isInvalid={!!errors.slug}
          errorMessage={errors.slug?.message}
          classNames={{ inputWrapper: "bg-default-100 dark:bg-default-50/10" }}
          description={t("slugHint")}
          startContent={<span className="text-xs text-default-400">orchester.io/w/</span>}
        />
        <div className="pt-2">{submitButton}</div>
      </motion.form>
    </motion.div>
  );
}
