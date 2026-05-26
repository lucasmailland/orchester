"use client";

import { useEffect, useState } from "react";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Textarea,
  Input,
  Slider,
  Switch,
} from "@heroui/react";
import { useTranslations } from "next-intl";
import { notify } from "@/lib/toast";
import { patchFact, type Fact } from "@/lib/hooks/use-brain-facts";

export interface EditFactDialogProps {
  fact: Fact | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: (next: Fact) => void;
}

const STATEMENT_MIN = 10;
const STATEMENT_MAX = 400;

export function EditFactDialog({ fact, isOpen, onClose, onSaved }: EditFactDialogProps) {
  const t = useTranslations("brain");
  const [subject, setSubject] = useState("");
  const [statement, setStatement] = useState("");
  const [confidence, setConfidence] = useState(0.5);
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!fact) return;
    setSubject(fact.subject);
    setStatement(fact.statement);
    setConfidence(fact.confidence ?? 0.5);
    setPinned(fact.pinned);
  }, [fact]);

  const valid =
    statement.length >= STATEMENT_MIN &&
    statement.length <= STATEMENT_MAX &&
    subject.trim().length > 0;

  async function handleSave() {
    if (!fact || !valid) return;
    setSaving(true);
    try {
      const next = await patchFact(fact.id, { subject, statement, confidence, pinned });
      notify.success(t("toast.saved"));
      onSaved(next);
      onClose();
    } catch {
      notify.error(t("toast.saveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" backdrop="blur">
      <ModalContent>
        <ModalHeader>
          <h2 className="text-base font-semibold text-strong">{t("detail.editTitle")}</h2>
        </ModalHeader>
        <ModalBody className="space-y-4">
          <Input
            label={t("detail.subject")}
            value={subject}
            onValueChange={setSubject}
            size="sm"
            isRequired
          />
          <div>
            <Textarea
              label={t("detail.statement")}
              value={statement}
              onValueChange={setStatement}
              minRows={3}
              maxRows={6}
              isInvalid={
                statement.length > 0 &&
                (statement.length < STATEMENT_MIN || statement.length > STATEMENT_MAX)
              }
              description={t("detail.characterCount", {
                used: statement.length,
                max: STATEMENT_MAX,
              })}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted">{t("detail.confidence")}</label>
            <Slider
              size="sm"
              minValue={0}
              maxValue={1}
              step={0.05}
              value={confidence}
              onChange={(v) => setConfidence(Array.isArray(v) ? (v[0] ?? 0) : v)}
              aria-label={t("detail.confidence")}
              className="mt-1"
            />
            <div className="mt-1 font-mono text-[10px] text-faint">
              {Math.round(confidence * 100)}%
            </div>
          </div>
          <Switch size="sm" isSelected={pinned} onValueChange={setPinned}>
            <span className="ml-1 text-xs text-body">{t("detail.pinned")}</span>
          </Switch>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose} isDisabled={saving}>
            {t("actions.discard")}
          </Button>
          <Button
            color="primary"
            onPress={handleSave}
            isDisabled={!valid || saving}
            isLoading={saving}
          >
            {t("actions.save")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
