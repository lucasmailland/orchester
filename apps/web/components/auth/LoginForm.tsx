"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Button, Input, Divider } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Mail, Lock, ArrowRight, Chrome } from "lucide-react";
import { signIn } from "@/lib/auth-client";
import { notify } from "@/lib/toast";
import { staggerContainer, staggerItem } from "@/lib/motion";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

type LoginValues = z.infer<typeof loginSchema>;

interface LoginFormProps {
  locale: string;
}

export function LoginForm({ locale }: LoginFormProps) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginValues) {
    setIsLoading(true);
    const { error } = await signIn.email({
      email: values.email,
      password: values.password,
      callbackURL: `/${locale}`,
    });

    if (error) {
      notify.error(t("invalidCredentials"));
      setIsLoading(false);
      return;
    }

    router.push(`/${locale}`);
  }

  async function handleGoogleSignIn() {
    setIsGoogleLoading(true);
    await signIn.social({
      provider: "google",
      callbackURL: `/${locale}`,
    });
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
          {t("welcomeBack")}
        </h1>
        <p className="text-sm text-default-500">{t("signIn")}</p>
      </motion.div>

      <motion.form
        variants={staggerItem}
        onSubmit={handleSubmit(onSubmit)}
        className="space-y-3"
      >
        <Input
          {...register("email")}
          type="email"
          label={t("email")}
          placeholder="you@company.com"
          startContent={<Mail size={15} className="shrink-0 text-default-400" />}
          isInvalid={!!errors.email}
          errorMessage={errors.email?.message}
          classNames={{
            inputWrapper:
              "bg-default-100 dark:bg-default-50/10 hover:bg-default-200 dark:hover:bg-default-50/20",
          }}
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
          classNames={{
            inputWrapper:
              "bg-default-100 dark:bg-default-50/10 hover:bg-default-200 dark:hover:bg-default-50/20",
          }}
          autoComplete="current-password"
        />

        <div className="flex justify-end">
          <button
            type="button"
            className="text-xs text-fichap-primary hover:underline"
          >
            {t("forgotPassword")}
          </button>
        </div>

        <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}>
          <Button
            type="submit"
            color="primary"
            className="w-full bg-[#3B3BFF] font-semibold"
            size="lg"
            isLoading={isLoading}
            endContent={!isLoading && <ArrowRight size={16} />}
          >
            {isLoading ? t("signingIn") : t("signInButton")}
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
          {t("noAccount")}{" "}
          <a
            href={`/${locale}/signup`}
            className="font-medium text-fichap-primary hover:underline"
          >
            {t("signUp")}
          </a>
        </p>
      </motion.div>
    </motion.div>
  );
}
