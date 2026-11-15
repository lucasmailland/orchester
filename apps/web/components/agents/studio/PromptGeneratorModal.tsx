"use client";

import { useState } from "react";
import { Sparkles, ArrowRight, RotateCcw, Loader2 } from "lucide-react";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button } from "@heroui/react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  agentId: string;
  onClose: () => void;
  onPick: (prompt: string) => void;
}

const TONES = ["professional", "friendly", "formal", "direct"] as const;

export function PromptGeneratorModal({ open, agentId, onClose, onPick }: Props) {
  const t = useTranslations("pages.agents.studio.promptGen");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [description, setDescription] = useState("");
  const [tone, setTone] = useState<(typeof TONES)[number]>("professional");
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [variations, setVariations] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/agents/${agentId}/generate-prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          tone,
          context: { companyName, industry },
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        if (j.error === "PROVIDER_NOT_CONFIGURED") setError(t("providerError"));
        else setError(j.error || t("genError"));
        return;
      }
      setVariations(j.variations);
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      isOpen={open}
      onOpenChange={(next) => {
        if (!next && !loading) onClose();
      }}
      placement="center"
      backdrop="blur"
      size="2xl"
      scrollBehavior="inside"
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader className="flex items-center gap-2.5 border-b border-line px-5 py-4 text-sm font-medium text-strong">
              <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              {t("stepHeader", { step })}
            </ModalHeader>

            <ModalBody className="p-5">
              {step === 1 && (
                <div>
                  <label className="mb-2 block text-xs font-medium text-body">
                    {t("step1Label")}
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={6}
                    placeholder={t("step1Placeholder")}
                    className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-strong placeholder:text-faint outline-none focus:border-violet-500/60"
                  />
                  <p className="mt-1.5 text-[11px] text-muted">
                    {t("charCount", { count: description.length })}
                  </p>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4">
                  <div>
                    <label className="mb-2 block text-xs font-medium text-body">
                      {t("toneLabel")}
                    </label>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {TONES.map((toneKey) => (
                        <button
                          key={toneKey}
                          type="button"
                          onClick={() => setTone(toneKey)}
                          className={cn(
                            "rounded-lg border px-2 py-2 text-xs",
                            tone === toneKey
                              ? "border-violet-500/50 bg-violet-500/15 text-violet-700 dark:text-violet-200"
                              : "border-line text-muted hover:border-white/20"
                          )}
                        >
                          {toneKey}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-medium text-body">
                      {t("companyLabel")}
                    </label>
                    <input
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-strong outline-none focus:border-violet-500/60"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-medium text-body">
                      {t("industryLabel")}
                    </label>
                    <input
                      value={industry}
                      onChange={(e) => setIndustry(e.target.value)}
                      className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-strong outline-none focus:border-violet-500/60"
                    />
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-3">
                  {error && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                      {error}
                    </div>
                  )}
                  {variations.map((v, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        onPick(v);
                        onClose();
                      }}
                      className="block w-full rounded-xl border border-line bg-card p-4 text-left hover:border-violet-500/40 hover:bg-surface"
                    >
                      <div className="mb-1 text-xs font-medium text-violet-700 dark:text-violet-300">
                        {t("variation", { n: i + 1 })}
                      </div>
                      <pre className="whitespace-pre-wrap font-mono text-[12px] text-body">
                        {v.length > 400 ? v.slice(0, 400) + "…" : v}
                      </pre>
                    </button>
                  ))}
                </div>
              )}
            </ModalBody>

            <ModalFooter className="flex items-center justify-between border-t border-line px-5 py-3">
              <Button
                variant="light"
                size="sm"
                onPress={() => {
                  if (step === 3) {
                    setStep(2);
                    setVariations([]);
                  } else if (step === 2) setStep(1);
                  else onClose();
                }}
                className="text-xs text-muted hover:text-body"
              >
                {step === 1 ? t("cancel") : t("back")}
              </Button>
              <div className="flex items-center gap-2">
                {step === 3 && (
                  <Button
                    variant="bordered"
                    size="sm"
                    onPress={generate}
                    startContent={<RotateCcw className="h-3.5 w-3.5" />}
                    className="text-xs"
                  >
                    {t("regenerate")}
                  </Button>
                )}
                {step !== 3 && (
                  <Button
                    color="secondary"
                    size="sm"
                    isLoading={loading}
                    isDisabled={loading || (step === 1 && description.trim().length < 20)}
                    onPress={() => {
                      if (step === 1) setStep(2);
                      else generate();
                    }}
                    endContent={
                      !loading ? (
                        <ArrowRight className="h-3.5 w-3.5" />
                      ) : (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      )
                    }
                    className="text-xs"
                  >
                    {step === 2 ? t("generate") : t("next")}
                  </Button>
                )}
              </div>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
