"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Button, Input, Divider } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail, Lock, User, ArrowRight, Chrome } from "lucide-react";
import { signUp, signIn } from "@/lib/auth-client";
import { notify } from "@/lib/toast";
import { staggerContainer, staggerItem } from "@/lib/motion";

const signupSchema = z
  .object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
    confirmPassword: z.string().min(8),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type SignupValues = z.infer<typeof signupSchema>;

interface SignupFormProps {
  locale: string;
}

export function SignupForm({ locale }: SignupFormProps) {
  const t = useTranslations("auth");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  /**
   * Si el usuario llegó desde /pricing con ?plan=pro, persistimos el plan en
   * una cookie para cobrarlo después del onboarding (sobrevive el redirect de
   * OAuth, a diferencia de sessionStorage). Sólo planes pagos.
   */
  function persistPendingPlan() {
    const plan = searchParams.get("plan");
    if (plan && ["starter", "pro", "business"].includes(plan)) {
      document.cookie = `pending_plan=${plan}; path=/; max-age=1800; samesite=lax`;
    }
  }

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupValues>({ resolver: zodResolver(signupSchema) });

  async function onSubmit(values: SignupValues) {
    setIsLoading(true);
    persistPendingPlan();
    const { error } = await signUp.email({
      name: values.name,
      email: values.email,
      password: values.password,
      callbackURL: `/${locale}/onboarding`,
    });

    if (error) {
      notify.error(error.message ?? t("emailTaken"));
      setIsLoading(false);
      return;
    }

    router.push(`/${locale}/onboarding`);
  }

  async function handleGoogleSignIn() {
    setIsGoogleLoading(true);
    persistPendingPlan();
    await signIn.social({ provider: "google", callbackURL: `/${locale}/onboarding` });
  }

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="w-full max-w-sm space-y-6"
    >
      <motion.div variants={staggerItem} className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-default-900 dark:text-default-100">
          {t("createAccount")}
        </h1>
        <p className="text-sm text-default-500">{t("startFree")}</p>
      </motion.div>

      <motion.form
        variants={staggerItem}
        onSubmit={handleSubmit(onSubmit)}
        className="space-y-3"
      >
        <Input
          {...register("name")}
          type="text"
          label={t("name")}
          placeholder={t("namePlaceholder")}
          startContent={<User size={15} className="shrink-0 text-default-400" />}
          isInvalid={!!errors.name}
          errorMessage={errors.name?.message}
          classNames={{ inputWrapper: "bg-default-100 dark:bg-default-50/10" }}
          autoComplete="name"
        />
        <Input
          {...register("email")}
          type="email"
          label={t("email")}
          placeholder="you@company.com"
          startContent={<Mail size={15} className="shrink-0 text-default-400" />}
          isInvalid={!!errors.email}
          errorMessage={errors.email?.message}
          classNames={{ inputWrapper: "bg-default-100 dark:bg-default-50/10" }}
          autoComplete="email"
        />
        <Input
          {...register("password")}
          type="password"
          label={t("password")}
          placeholder="••••••••"
          startContent={<Lock size={15} className="shrink-0 text-default-400" />}
          isInvalid={!!errors.password}
          errorMessage={errors.password?.message}
          classNames={{ inputWrapper: "bg-default-100 dark:bg-default-50/10" }}
          autoComplete="new-password"
        />
        <Input
          {...register("confirmPassword")}
          type="password"
          label={t("confirmPassword")}
          placeholder="••••••••"
          startContent={<Lock size={15} className="shrink-0 text-default-400" />}
          isInvalid={!!errors.confirmPassword}
          errorMessage={errors.confirmPassword?.message}
          classNames={{ inputWrapper: "bg-default-100 dark:bg-default-50/10" }}
          autoComplete="new-password"
        />

        <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}>
          <Button
            type="submit"
            color="primary"
            className="w-full bg-[#3B3BFF] font-semibold"
            size="lg"
            isLoading={isLoading}
            endContent={!isLoading && <ArrowRight size={16} />}
          >
            {isLoading ? t("creatingAccount") : t("createAccount")}
          </Button>
        </motion.div>
      </motion.form>

      <motion.div variants={staggerItem} className="space-y-3">
        <div className="flex items-center gap-3">
          <Divider className="flex-1" />
          <span className="text-xs text-default-400">{t("orContinueWith")}</span>
          <Divider className="flex-1" />
        </div>

        <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}>
          <Button
            variant="bordered"
            className="w-full font-medium"
            size="lg"
            startContent={<Chrome size={16} />}
            isLoading={isGoogleLoading}
            onPress={handleGoogleSignIn}
          >
            {t("googleSignIn")}
          </Button>
        </motion.div>

        <p className="text-center text-sm text-default-500">
          {t("alreadyAccount")}{" "}
          <a
            href={`/${locale}/login`}
            className="font-medium text-fichap-primary hover:underline"
          >
            {t("signInButton")}
          </a>
        </p>
      </motion.div>
    </motion.div>
  );
}
