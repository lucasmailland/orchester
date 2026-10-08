"use client";

/**
 * Confirmation for deleting a flow. Asks the server what the delete would
 * destroy (`GET /api/flows/:id/delete-impact`) and says so in plain words; if
 * something blocks the delete (flow enabled, agents, other flows or external
 * callers that depend on it) it lists the blockers instead of offering the confirm button.
 * The DELETE route enforces the same rules, so this is guidance, not the gate.
 */

import { useEffect, useState } from "react";
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Button } from "@heroui/react";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

interface DeleteImpact {
  counts: { runs: number; versions: number; webhooks: number; schedules: number };
  blockers: {
    enabled: boolean;
    agents: Array<{ id: string; name: string }>;
    flows: Array<{ id: string; name: string }>;
    /** Optional: servers that predate flow labelling do not send it. */
    externalCallers?: Array<{ name: string; note?: string }>;
  };
}

type LoadState =
  { status: "loading" } | { status: "error" } | { status: "ready"; impact: DeleteImpact };

export interface DeleteFlowDialogProps {
  open: boolean;
  flowId: string;
  flowName: string;
  onClose: () => void;
  /** Called after the flow was deleted; the caller navigates or updates its list. */
  onDeleted: () => void;
}

export function DeleteFlowDialog({
  open,
  flowId,
  flowName,
  onClose,
  onDeleted,
}: DeleteFlowDialogProps) {
  const t = useTranslations("pages.flows.builder");
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      try {
        const r = await fetch(`/api/flows/${flowId}/delete-impact`);
        if (!r.ok) throw new Error(String(r.status));
        const impact = (await r.json()) as DeleteImpact;
        if (!cancelled) setState({ status: "ready", impact });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, flowId]);

  async function confirmDelete() {
    setPending(true);
    try {
      const r = await fetch(`/api/flows/${flowId}`, { method: "DELETE" });
      if (r.ok) {
        toast.success(t("flowDeleted"));
        onDeleted();
        return;
      }
      const body = (await r.json().catch(() => null)) as { error?: string } | null;
      toast.error(body?.error ?? t("deleteError"));
    } catch {
      toast.error(t("deleteError"));
    } finally {
      setPending(false);
    }
  }

  const impact = state.status === "ready" ? state.impact : null;
  const b = impact?.blockers;
  const external = b?.externalCallers ?? [];
  const blocked =
    !!b && (b.enabled || b.agents.length > 0 || b.flows.length > 0 || external.length > 0);
  const names = (list: Array<{ name: string }>) => list.map((x) => x.name).join(", ");

  return (
    <Modal
      isOpen={open}
      onClose={() => {
        if (!pending) onClose();
      }}
      isDismissable={!pending}
      backdrop="blur"
      size="md"
      placement="center"
      classNames={{ base: "bg-surface border border-line", closeButton: "text-muted" }}
    >
      <ModalContent>
        <ModalHeader className="flex items-start gap-3 px-5 pb-2 pt-5">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500/15 text-red-600 dark:text-red-400"
            aria-hidden="true"
          >
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-tight text-strong">
              {t("deleteFlowConfirm")}
            </h2>
            <p className="mt-1 truncate text-xs text-muted">{flowName}</p>
          </div>
        </ModalHeader>
        <ModalBody className="px-5 pb-4 text-xs leading-relaxed text-body">
          {state.status === "loading" && <p>{t("deleteImpactLoading")}</p>}
          {state.status === "error" && <p>{t("deleteImpactError")}</p>}
          {impact && b && blocked && (
            <div className="space-y-2">
              <p className="font-medium text-strong">{t("deleteBlockedIntro")}</p>
              <ul className="list-disc space-y-1 pl-4">
                {b.enabled && <li>{t("deleteBlockedEnabled")}</li>}
                {b.agents.length > 0 && (
                  <li>{t("deleteBlockedAgents", { names: names(b.agents) })}</li>
                )}
                {b.flows.length > 0 && (
                  <li>{t("deleteBlockedFlows", { names: names(b.flows) })}</li>
                )}
                {external.length > 0 && (
                  <li>{t("deleteBlockedExternal", { names: names(external) })}</li>
                )}
              </ul>
            </div>
          )}
          {impact && !blocked && <p>{t("deleteImpactSummary", impact.counts)}</p>}
        </ModalBody>
        <ModalFooter className="px-5 py-3">
          <Button variant="light" size="sm" isDisabled={pending} onPress={onClose}>
            {blocked || state.status === "error" ? t("deleteClose") : t("deleteCancel")}
          </Button>
          {impact && !blocked && (
            <Button
              color="danger"
              size="sm"
              isLoading={pending}
              isDisabled={pending}
              onPress={() => void confirmDelete()}
              className="font-medium"
            >
              {t("deleteConfirmAction")}
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
