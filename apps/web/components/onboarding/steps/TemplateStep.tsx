"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Button, Card, CardBody } from "@heroui/react";
import { useTranslations } from "next-intl";
import { Users, Headphones, UserPlus, SkipForward } from "lucide-react";
import { staggerContainer, staggerItem, cardHover } from "@/lib/motion";

interface TemplateStepProps {
  onNext: (templateId: string | null) => void;
  onSkip: () => void;
}

const TEMPLATES = [
  {
    id: "hr-benefits",
    icon: <Users size={20} />,
    name: "HR Benefits Assistant",
    description: "Vacations, leaves, and benefits for your team",
    color: "from-[#3B3BFF] to-[#7C3AED]",
  },
  {
    id: "it-support",
    icon: <Headphones size={20} />,
    name: "IT Support",
    description: "Internal helpdesk with ticket management",
    color: "from-[#0EA5E9] to-[#6366F1]",
  },
  {
    id: "onboarding-emp",
    icon: <UserPlus size={20} />,
    name: "Employee Onboarding",
    description: "Guide new hires through their first weeks",
    color: "from-[#22C55E] to-[#0EA5E9]",
  },
];

export function TemplateStep({ onNext, onSkip }: TemplateStepProps) {
  const t = useTranslations("onboarding.step3");
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <motion.div variants={staggerItem}>
        <h2 className="text-xl font-bold text-foreground">{t("title")}</h2>
        <p className="mt-1 text-sm text-default-500">{t("description")}</p>
      </motion.div>

      <motion.div variants={staggerItem} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {TEMPLATES.map((tmpl) => (
          <motion.div key={tmpl.id} variants={cardHover} initial="rest" whileHover="hover">
            <Card
              isPressable
              onPress={() => setSelected(tmpl.id)}
              className={`cursor-pointer transition-all duration-150 ${
                selected === tmpl.id ? "ring-2 ring-fichap-primary ring-offset-2" : ""
              }`}
            >
              <CardBody className="gap-3 p-4">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${tmpl.color} text-white`}
                >
                  {tmpl.icon}
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{tmpl.name}</p>
                  <p className="text-xs text-default-500">{tmpl.description}</p>
                </div>
              </CardBody>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      <motion.div variants={staggerItem} className="flex gap-3">
        <Button
          color="primary"
          className="flex-1 bg-[#3B3BFF] font-semibold"
          isDisabled={!selected}
          onPress={() => onNext(selected)}
        >
          {t("useTemplate")}
        </Button>
        <Button variant="flat" onPress={() => onNext(null)}>
          {t("startBlank")}
        </Button>
        <Button variant="light" onPress={onSkip} startContent={<SkipForward size={15} />}>
          {t("skip")}
        </Button>
      </motion.div>
    </motion.div>
  );
}
