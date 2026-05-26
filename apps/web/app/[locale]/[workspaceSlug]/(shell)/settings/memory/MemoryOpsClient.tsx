"use client";

import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  Layers,
  Lock,
  PinIcon,
  ScanSearch,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { useTranslations } from "next-intl";
import { notify } from "@/lib/toast";
import { useBrainHealthLatest } from "@/lib/hooks/use-brain-health";

/**
 * Memory Operations panel — admin-only "Run now" triggers for the
 * seven Mnemosyne crons.
 *
 * Each op is a card with a short description + a "Run now" button.
 * Clicking pops a confirm modal (the operations write to mnemo_*
 * tables on the worker side; a stray click while debugging shouldn't
 * silently kick off prune). On confirm we POST to the matching
 * `/api/mnemo/admin/run-*` route and surface a toast.
 *
 * For the health op we display the most recent `mnemo_health` snapshot
 * timestamp as "Last run" — that's the only cron whose persisted shape
 * already records when it last ran. The others get an em-dash until
 * v1.6 adds per-job last-run tracking.
 *
 * Buttons are disabled (with a lock icon stub) when the caller isn't
 * an admin. The server re-enforces via `requireAuth({ minRole: 'admin' })`.
 */

type OpId = "health" | "dedup" | "prune" | "consolidation" | "review-sweep" | "auto-pin";

interface OpDef {
  id: OpId;
  endpoint: string;
  icon: typeof Activity;
}

const OPS: OpDef[] = [
  { id: "health", endpoint: "/api/mnemo/admin/run-health", icon: Activity },
  { id: "dedup", endpoint: "/api/mnemo/admin/run-dedup", icon: Layers },
  { id: "prune", endpoint: "/api/mnemo/admin/run-prune", icon: Trash2 },
  {
    id: "consolidation",
    endpoint: "/api/mnemo/admin/run-consolidation",
    icon: BrainCircuit,
  },
  {
    id: "review-sweep",
    endpoint: "/api/mnemo/admin/run-review-sweep",
    icon: ScanSearch,
  },
  { id: "auto-pin", endpoint: "/api/mnemo/admin/run-auto-pin", icon: PinIcon },
];

interface Props {
  workspace: { id: string; slug: string };
  isAdmin: boolean;
}

export function MemoryOpsClient({ isAdmin }: Props) {
  const t = useTranslations("settings.memory");
  const { snapshot } = useBrainHealthLatest();
  const [pending, setPending] = useState<OpId | null>(null);
  const [confirming, setConfirming] = useState<OpDef | null>(null);

  const healthLastRun = readSnapshotAt(snapshot);

  async function runOp(op: OpDef) {
    setPending(op.id);
    try {
      const res = await fetch(op.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      notify.success(t("toast.enqueued"));
    } catch (err) {
      notify.error(
        t("toast.enqueueError", {
          message: err instanceof Error ? err.message : "unknown",
        })
      );
    } finally {
      setPending(null);
      setConfirming(null);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <div className="rounded-lg bg-violet-500/10 p-2.5">
          <Sparkles className="h-5 w-5 text-violet-500" />
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight text-strong">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
        </div>
      </header>

      {!isAdmin ? (
        <div className="flex items-start gap-3 rounded-2xl border border-line bg-card p-4 text-sm text-muted">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-faint" />
          <p>{t("adminOnly")}</p>
        </div>
      ) : null}

      <ul className="grid gap-3 md:grid-cols-2">
        {OPS.map((op) => {
          const Icon = op.icon;
          const lastRun = op.id === "health" ? healthLastRun : null;
          return (
            <li
              key={op.id}
              className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-4"
            >
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-elevated p-2">
                  <Icon className="h-4 w-4 text-violet-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-strong">{t(`ops.${op.id}.name`)}</h3>
                  <p className="mt-1 text-xs text-muted">{t(`ops.${op.id}.description`)}</p>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-line/50 pt-3 text-[11px] text-faint">
                <span>
                  {t("lastRun")}:{" "}
                  <span className="text-body">
                    {lastRun ? new Date(lastRun).toLocaleString() : "—"}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="flat"
                  color="primary"
                  isDisabled={!isAdmin || pending !== null}
                  isLoading={pending === op.id}
                  onPress={() => setConfirming(op)}
                >
                  {t("actions.runNow")}
                </Button>
              </div>
            </li>
          );
        })}
        {/* Summary refresh — needs an agentId, surfaced as a stub for v1.6
            (per the brief: the panel "renders 7 buttons" but the seventh
            operation requires an agent picker that isn't in scope here). */}
        <li className="flex flex-col gap-3 rounded-2xl border border-dashed border-line/70 bg-card/60 p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-elevated p-2">
              <Sparkles className="h-4 w-4 text-violet-500" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-strong">{t("ops.summary.name")}</h3>
              <p className="mt-1 text-xs text-muted">{t("ops.summary.description")}</p>
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-line/50 pt-3 text-[11px] text-faint">
            <span className="inline-flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t("ops.summary.requiresAgent")}
            </span>
            <Button size="sm" variant="flat" isDisabled>
              {t("actions.runNow")}
            </Button>
          </div>
        </li>
      </ul>

      <ConfirmRunModal
        op={confirming}
        running={pending !== null && confirming?.id === pending}
        onClose={() => setConfirming(null)}
        onConfirm={() => confirming && runOp(confirming)}
      />
    </div>
  );
}

interface ConfirmRunModalProps {
  op: OpDef | null;
  running: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

function ConfirmRunModal({ op, running, onClose, onConfirm }: ConfirmRunModalProps) {
  const t = useTranslations("settings.memory");
  return (
    <Modal isOpen={!!op} onClose={onClose} size="md" backdrop="blur">
      <ModalContent>
        <ModalHeader>
          <h2 className="text-base font-semibold text-strong">
            {op ? t("confirm.title", { op: t(`ops.${op.id}.name`) }) : ""}
          </h2>
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-muted">{t("confirm.body")}</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose} isDisabled={running}>
            {t("actions.cancel")}
          </Button>
          <Button color="primary" onPress={onConfirm} isLoading={running}>
            {t("actions.runNow")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

/**
 * Defensive read of the `snapshot_at` / `capturedAt` field — different
 * call sites have used both names. The shape is `[extra: string]:
 * unknown` so we have to widen.
 */
function readSnapshotAt(snapshot: unknown): string | Date | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const obj = snapshot as Record<string, unknown>;
  const v = obj["snapshotAt"] ?? obj["snapshot_at"] ?? obj["capturedAt"] ?? obj["captured_at"];
  if (typeof v === "string" || v instanceof Date) return v;
  return null;
}
