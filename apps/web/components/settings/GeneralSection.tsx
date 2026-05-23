"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Field, FieldRow, SettingsCard } from "./_layout";

interface Props {
  workspace: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    role: string;
  };
}

/**
 * Lista corta y curada de timezones IANA. Si el operador necesita una más
 * exótica, puede tipearla a mano (validamos en el server con Intl.DateTimeFormat).
 */
const COMMON_TZS = [
  "UTC",
  "America/Argentina/Buenos_Aires",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "America/Bogota",
  "America/Santiago",
  "America/Lima",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/Madrid",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
];

export function GeneralSection({ workspace }: Props) {
  const router = useRouter();
  const t = useTranslations("pages.settings.general");
  const canEdit = workspace.role === "owner" || workspace.role === "admin";
  const [name, setName] = useState(workspace.name);
  const [timezone, setTimezone] = useState(workspace.timezone);
  const [saving, setSaving] = useState(false);

  const dirty = name.trim() !== workspace.name || timezone !== workspace.timezone;

  async function save() {
    if (!dirty) return;
    setSaving(true);
    const r = await fetch(`/api/workspaces/${workspace.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), timezone }),
    });
    setSaving(false);
    if (r.ok) {
      toast.success(t("saved"));
      router.refresh();
    } else {
      const j = await r.json().catch(() => ({}));
      toast.error(j.error ?? t("saveError"));
    }
  }

  return (
    <SettingsCard
      icon={<Building2 size={16} />}
      title={t("title")}
      description={t("description")}
      action={
        canEdit ? (
          <button type="button" onClick={save} disabled={!dirty || saving} className="btn-primary">
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {t("save")}
          </button>
        ) : null
      }
    >
      <FieldRow>
        <Field label={t("nameLabel")} htmlFor="ws-name">
          <input
            id="ws-name"
            name="workspace-name"
            value={name}
            disabled={!canEdit}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            maxLength={80}
            className="input"
          />
        </Field>
        <Field label={t("slugLabel")} htmlFor="ws-slug" hint={t("slugHint")}>
          <input
            id="ws-slug"
            name="workspace-slug"
            value={workspace.slug}
            readOnly
            className="input cursor-not-allowed opacity-60"
          />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label={t("timezoneLabel")} htmlFor="ws-tz" hint={t("timezoneHint")}>
          <input
            id="ws-tz"
            name="workspace-timezone"
            list="ws-tz-options"
            value={timezone}
            disabled={!canEdit}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="UTC"
            className="input"
          />
          <datalist id="ws-tz-options">
            {COMMON_TZS.map((tz) => (
              <option key={tz} value={tz} />
            ))}
          </datalist>
        </Field>
        <Field label={t("roleLabel")} htmlFor="ws-role" hint={t("roleHint")}>
          <input
            id="ws-role"
            value={workspace.role}
            readOnly
            className="input cursor-not-allowed opacity-60 capitalize"
          />
        </Field>
      </FieldRow>
    </SettingsCard>
  );
}
