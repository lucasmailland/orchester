"use client";

import { motion } from "framer-motion";
import { Users, Bot, MessageSquare, Briefcase } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { useTranslations } from "next-intl";

export default function EmptyShowcasePage() {
  const t = useTranslations("emptyStates");

  const examples = [
    {
      icon: <Users size={24} />,
      title: t("teams.title"),
      description: t("teams.description"),
      ctaLabel: t("teams.cta"),
    },
    {
      icon: <Bot size={24} />,
      title: t("agents.title"),
      description: t("agents.description"),
      ctaLabel: t("agents.cta"),
    },
    {
      icon: <MessageSquare size={24} />,
      title: t("conversations.title"),
      description: t("conversations.description"),
      ctaLabel: t("conversations.cta"),
    },
    {
      icon: <Briefcase size={24} />,
      title: t("employees.title"),
      description: t("employees.description"),
      ctaLabel: t("employees.cta"),
    },
  ];

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="space-y-8"
    >
      <motion.div variants={staggerItem}>
        <h1 className="text-2xl font-semibold tracking-tight text-default-900 dark:text-default-100">
          Empty States
        </h1>
        <p className="mt-1 text-sm text-default-500">
          Personality-driven empty states for every major list
        </p>
      </motion.div>

      <motion.div variants={staggerItem} className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {examples.map((ex) => (
          <EmptyState
            key={ex.title}
            icon={ex.icon}
            title={ex.title}
            description={ex.description}
            ctaLabel={ex.ctaLabel}
            onCta={() => {}}
          />
        ))}
      </motion.div>
    </motion.div>
  );
}
