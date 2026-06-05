"use client";

/**
 * CronScheduleEditor — modal to edit the per-workspace cron
 * periodicity for one Mnemosyne housekeeping job.
 *
 * UX
 * --
 *  - One radio per mode (default / hourly / daily / weekly / monthly /
 *    custom / disabled). Each mode shows a one-line hint.
 *  - When mode = custom, a text input appears for the cron expression
 *    with a tiny "format help" line.
 *  - When mode = disabled, a red callout warns the operator that the
 *    task will not run for this workspace.
 *  - Header always shows the GLOBAL default cadence so operators
 *    understand that their choice is an UPPER BOUND, never a way to
 *    fire more often than the system schedule.
 *
 * Save flow
 * ---------
 * Calls `PATCH /api/mnemo/cron-schedules/[jobKey]` with `{ mode,
 * customCronExpression? }`. On success, mutates the parent SWR cache
 * so the calling list re-renders with the new mode without a page
 * reload.
 *
 * Voice — Compass: clear, professional. Spanish "tú", pt "você".
 */

import { useEffect, useState, type JSX } from "react";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  RadioGroup,
  Radio,
  Input,
} from "@heroui/react";
import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { notify } from "@/lib/toast";
import type { CronJobKey, CronMode } from "@/lib/mnemo/cron-policy";
import { Callout } from "@/components/compass/Callout";

/**
 * Default GLOBAL schedule per job (mirrored from worker/index.ts).
 * Used purely to inform the operator of the system cadence — the
 * actual schedule lives in the worker boot code.
 *
 * Keep in sync with apps/web/worker/index.ts. The i18n layer doesn't
 * need to translate cron expressions; they're already universal.
 */
const GLOBAL_DEFAULTS: Record<CronJobKey, string> = {
  healthSnapshot: "0 6 * * *", // daily 06:00 UTC
  dedup: "0 3 * * 0", // weekly Sunday 03:00 UTC
  prune: "30 3 * * 0", // weekly Sunday 03:30 UTC
  remConsolidation: "0 2 * * 0", // weekly Sunday 02:00 UTC
  reviewSweep: "0 4 * * *", // daily 04:00 UTC
  autoPin: "30 4 * * *", // daily 04:30 UTC
  summaryRefresh: "0 5 * * *", // daily 05:00 UTC
};

export interface CronSchedule {
  jobKey: CronJobKey;
  jobName: string;
  mode: CronMode;
  customCronExpression: string | null;
  lastRunAt: string | null;
}

interface CronScheduleEditorProps {
  /** The schedule row to edit (or null when no row exists). */
  schedule: CronSchedule;
  /** Translated task display name for the modal title. */
  taskName: string;
  /** Locale for last-run formatting. */
  locale: string;
  /** Controlled open state. */
  isOpen: boolean;
  /** Close handler — also called after a successful save. */
  onClose: () => void;
  /** Called after a successful PATCH so the parent SWR cache can refresh. */
  onSaved: () => void | Promise<void>;
}

const MODES: CronMode[] = ["default", "hourly", "daily", "weekly", "monthly", "custom", "disabled"];

export function CronScheduleEditor({
  schedule,
  taskName,
  locale,
  isOpen,
  onClose,
  onSaved,
}: CronScheduleEditorProps): JSX.Element {
  const t = useTranslations("compass.memoryOps.schedule");

  const [mode, setMode] = useState<CronMode>(schedule.mode);
  const [customExpr, setCustomExpr] = useState<string>(schedule.customCronExpression ?? "");
  const [saving, setSaving] = useState(false);

  // Re-sync local state when the modal opens for a new schedule
  // (we keep one editor instance and switch payload via props).
  useEffect(() => {
    if (!isOpen) return;
    setMode(schedule.mode);
    setCustomExpr(schedule.customCronExpression ?? "");
  }, [isOpen, schedule.mode, schedule.customCronExpression]);

  const isCustomMissing = mode === "custom" && customExpr.trim().length === 0;
  const canSave = !saving && !isCustomMissing;

  async function handleSave(): Promise<void> {
    if (!canSave) return;
    setSaving(true);
    try {
      const body: { mode: CronMode; customCronExpression?: string } = { mode };
      if (mode === "custom") body.customCronExpression = customExpr.trim();

      const res = await fetch(`/api/mnemo/cron-schedules/${schedule.jobKey}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      notify.success(t("savedToast"));
      await onSaved();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      notify.error(t("saveErrorToast"), { description: message });
    } finally {
      setSaving(false);
    }
  }

  const globalCron = GLOBAL_DEFAULTS[schedule.jobKey];

  const lastRunLabel = (() => {
    if (!schedule.lastRunAt) return t("lastRunNever");
    try {
      return new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(schedule.lastRunAt));
    } catch {
      return t("lastRunNever");
    }
  })();

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
      placement="center"
      backdrop="blur"
      size="lg"
      classNames={{ base: "max-w-[560px]" }}
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader className="flex flex-col gap-1 px-6 pt-6">
              <h2 className="font-display text-lg font-bold tracking-tight text-strong">
                {t("modalTitle", { name: taskName })}
              </h2>
              <p className="text-sm text-muted">{t("modalSubtitle")}</p>
            </ModalHeader>

            <ModalBody className="space-y-4 px-6 py-4">
              {/* Always-visible global default + last-run telemetry */}
              <div className="rounded-xl border border-line bg-elevated p-3">
                <dl className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <dt className="text-faint">{t("globalLabel")}</dt>
                    <dd className="mt-0.5 font-mono text-strong">{globalCron}</dd>
                  </div>
                  <div>
                    <dt className="text-faint">{t("lastRunLabel")}</dt>
                    <dd className="mt-0.5 text-strong">{lastRunLabel}</dd>
                  </div>
                </dl>
              </div>

              <RadioGroup
                label={t("modesLabel")}
                value={mode}
                onValueChange={(v) => setMode(v as CronMode)}
                size="sm"
                classNames={{ label: "text-xs font-semibold uppercase tracking-wider text-faint" }}
              >
                {MODES.map((m) => (
                  <Radio
                    key={m}
                    value={m}
                    description={t(`modes.${m}Hint`)}
                    classNames={{ label: "text-sm font-medium text-body" }}
                  >
                    {t(`modes.${m}`)}
                  </Radio>
                ))}
              </RadioGroup>

              {mode === "custom" ? (
                <div className="space-y-1.5">
                  <Input
                    label={t("customInputLabel")}
                    value={customExpr}
                    onValueChange={setCustomExpr}
                    placeholder={t("customPlaceholder")}
                    size="sm"
                    isRequired
                    classNames={{ input: "font-mono" }}
                  />
                  <p className="text-[11px] text-faint">{t("customHelp")}</p>
                </div>
              ) : null}

              {mode === "disabled" ? (
                <Callout variant="warning" icon={AlertCircle}>
                  {t("disabledWarning")}
                </Callout>
              ) : null}

              <p className="text-[11px] leading-relaxed text-faint">{t("maxFreqNote")}</p>
            </ModalBody>

            <ModalFooter className="px-6 pb-6 pt-2">
              <Button variant="light" size="sm" onPress={onClose} isDisabled={saving}>
                {t("cancel")}
              </Button>
              <Button
                color="primary"
                size="sm"
                onPress={handleSave}
                isDisabled={!canSave}
                isLoading={saving}
                className="bg-gradient-to-r from-violet-600 to-blue-600 font-semibold text-white"
              >
                {t("save")}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

export default CronScheduleEditor;
