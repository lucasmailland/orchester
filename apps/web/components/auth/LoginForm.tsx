"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Mail, Lock, ArrowRight } from "lucide-react";
import { signIn } from "@/lib/auth-client";
import { notify } from "@/lib/toast";
import { cn } from "@/lib/utils";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

type LoginValues = z.infer<typeof loginSchema>;

interface LoginFormProps {
  locale: string;
}

const GoogleIcon = () => (
  <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
    <path d="M17.64 9.2a9.06 9.06 0 0 0-.14-1.6H9v3.02h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92C16.54 14 17.64 11.8 17.64 9.2z" fill="#4285F4"/>
    <path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26a5.4 5.4 0 0 1-3.04.85 5.37 5.37 0 0 1-5.06-3.71H.93v2.33A9 9 0 0 0 9 18z" fill="#34A853"/>
    <path d="M3.94 10.71A5.41 5.41 0 0 1 3.66 9c0-.59.1-1.17.28-1.71V4.96H.93A9 9 0 0 0 0 9c0 1.45.35 2.82.93 4.04l3.01-2.33z" fill="#FBBC05"/>
    <path d="M9 3.58a4.87 4.87 0 0 1 3.44 1.35l2.58-2.58A8.66 8.66 0 0 0 9 0a9 9 0 0 0-8.07 4.96l3.01 2.33A5.37 5.37 0 0 1 9 3.58z" fill="#EA4335"/>
  </svg>
);

const Spinner = () => (
  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

const inputClass = cn(
  "w-full rounded-xl border bg-zinc-900/50 px-4 py-3 pl-10 text-sm text-zinc-100 placeholder-zinc-700",
  "outline-none transition-all duration-200",
  "focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/30 focus:bg-zinc-900",
  "hover:border-zinc-700 border-zinc-800"
);

const inputErrorClass = cn(
  "w-full rounded-xl border bg-zinc-900/50 px-4 py-3 pl-10 text-sm text-zinc-100 placeholder-zinc-700",
  "outline-none transition-all duration-200",
  "border-red-500/50 ring-1 ring-red-500/20"
);

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
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
      className="w-full space-y-7"
    >
      {/* Status pill */}
      <motion.div
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="flex items-center gap-2"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/60" />
        <span
          className="text-[10px] uppercase tracking-widest text-zinc-600"
          style={{ fontFamily: "var(--font-auth-mono), monospace" }}
        >
          Secure Connection
        </span>
      </motion.div>

      {/* Heading */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.4 }}
      >
        <h1
          className="text-[2rem] font-bold leading-tight tracking-tight text-zinc-100"
          style={{ fontFamily: "var(--font-syne), system-ui, sans-serif" }}
        >
          {t("welcomeBack")}
        </h1>
        <p className="mt-1.5 text-sm text-zinc-600">{t("signIn")}</p>
      </motion.div>

      {/* Form */}
      <motion.form
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.22, duration: 0.4 }}
        onSubmit={handleSubmit(onSubmit)}
        className="space-y-3"
      >
        {/* Email */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-500">{t("email")}</label>
          <div className="relative">
            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600" />
            <input
              {...register("email")}
              type="email"
              placeholder="you@company.com"
              autoComplete="email"
              className={errors.email ? inputErrorClass : inputClass}
            />
          </div>
          {errors.email && (
            <p className="text-xs text-red-400">{errors.email.message}</p>
          )}
        </div>

        {/* Password */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-zinc-500">{t("password")}</label>
            <button
              type="button"
              className="text-xs text-zinc-600 transition-colors hover:text-violet-400"
            >
              {t("forgotPassword")}
            </button>
          </div>
          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600" />
            <input
              {...register("password")}
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              className={errors.password ? inputErrorClass : inputClass}
            />
          </div>
          {errors.password && (
            <p className="text-xs text-red-400">{errors.password.message}</p>
          )}
        </div>

        {/* Submit */}
        <div className="pt-1">
          <button
            type="submit"
            disabled={isLoading}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white",
              "bg-gradient-to-r from-violet-600 to-indigo-600",
              "shadow-lg shadow-violet-500/20 transition-all duration-200",
              "hover:from-violet-500 hover:to-indigo-500 hover:shadow-violet-500/30",
              "focus:outline-none focus:ring-2 focus:ring-violet-500/50",
              "disabled:cursor-not-allowed disabled:opacity-60"
            )}
          >
            {isLoading ? (
              <>
                <Spinner />
                {t("signingIn")}
              </>
            ) : (
              <>
                {t("signInButton")}
                <ArrowRight size={14} />
              </>
            )}
          </button>
        </div>
      </motion.form>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-zinc-800/80" />
        <span className="text-[11px] uppercase tracking-widest text-zinc-700">
          {t("orContinueWith")}
        </span>
        <div className="h-px flex-1 bg-zinc-800/80" />
      </div>

      {/* Google */}
      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={isGoogleLoading}
        className={cn(
          "flex w-full items-center justify-center gap-2.5 rounded-xl border border-zinc-800",
          "bg-zinc-900/50 px-4 py-3 text-sm font-medium text-zinc-400",
          "transition-all duration-200 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-200",
          "disabled:cursor-not-allowed disabled:opacity-60"
        )}
      >
        {isGoogleLoading ? <Spinner /> : <GoogleIcon />}
        {t("googleSignIn")}
      </button>

      {/* Sign up */}
      <p className="text-center text-sm text-zinc-700">
        {t("noAccount")}{" "}
        <a
          href={`/${locale}/signup`}
          className="font-medium text-violet-400 transition-colors hover:text-violet-300"
        >
          {t("signUp")}
        </a>
      </p>
    </motion.div>
  );
}
