"use client";

import { motion } from "framer-motion";
import { Button, Input, Divider } from "@heroui/react";
import { useTranslations } from "next-intl";
import { Mail, Lock, ArrowRight } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";

export default function LoginPage() {
  const t = useTranslations("auth");

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="w-full max-w-sm space-y-6"
    >
      {/* Logo mark (mobile only) */}
      <motion.div variants={staggerItem} className="flex justify-center md:hidden">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#3B3BFF] to-[#7C3AED]">
          <span className="text-sm font-bold text-white">O</span>
        </div>
      </motion.div>

      {/* Heading */}
      <motion.div variants={staggerItem} className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-default-900 dark:text-default-100">
          {t("welcomeBack")}
        </h1>
        <p className="text-sm text-default-500">{t("signIn")}</p>
      </motion.div>

      {/* Form */}
      <motion.div variants={staggerItem} className="space-y-3">
        <Input
          type="email"
          label={t("email")}
          placeholder="you@company.com"
          startContent={<Mail size={15} className="text-default-400 shrink-0" />}
          classNames={{
            inputWrapper:
              "bg-default-100 dark:bg-default-50/10 hover:bg-default-200 dark:hover:bg-default-50/20",
          }}
          autoComplete="email"
        />
        <Input
          type="password"
          label={t("password")}
          placeholder="••••••••"
          startContent={<Lock size={15} className="text-default-400 shrink-0" />}
          classNames={{
            inputWrapper:
              "bg-default-100 dark:bg-default-50/10 hover:bg-default-200 dark:hover:bg-default-50/20",
          }}
          autoComplete="current-password"
        />
      </motion.div>

      {/* Forgot password */}
      <motion.div variants={staggerItem} className="flex justify-end">
        <button className="text-xs text-fichap-primary hover:underline">
          {t("forgotPassword")}
        </button>
      </motion.div>

      {/* Submit */}
      <motion.div
        variants={staggerItem}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
      >
        <Button
          color="primary"
          className="w-full bg-[#3B3BFF] font-semibold"
          size="lg"
          endContent={<ArrowRight size={16} />}
        >
          {t("signInButton")}
        </Button>
      </motion.div>

      {/* Divider + sign up */}
      <motion.div variants={staggerItem}>
        <Divider />
        <p className="mt-4 text-center text-sm text-default-500">
          {t("noAccount")}{" "}
          <button className="font-medium text-fichap-primary hover:underline">
            {t("signUp")}
          </button>
        </p>
      </motion.div>
    </motion.div>
  );
}
