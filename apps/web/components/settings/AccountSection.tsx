"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import { User, Loader2, Trash2, AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Field, FieldRow, SettingsCard } from "./_layout";
import { TwoFactorSection } from "./TwoFactorSection";

interface Props {
  me: {
    id: string;
    name: string;
    email: string;
    preferredLocale: string;
    preferredTheme: string;
    twoFactorEnabled?: boolean;
  };
}

const LOCALES = [
  { value: "en", label: "🇺🇸 English" },
  { value: "es", label: "🇪🇸 Español" },
  { value: "pt", label: "🇧🇷 Português (BR)" },
];

export function AccountSection({ me }: Props) {
  const router = useRouter();
  const t = useTranslations("pages.settings.account");
  const pathname = usePathname();
  const [name, setName] = useState(me.name);
  const [locale, setLocale] = useState(me.preferredLocale);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  const dirty = name.trim() !== me.name || locale !== me.preferredLocale;

  async function save() {
    if (!dirty) return;
    setSaving(true);
    const r = await fetch("/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        preferredLocale: locale,
      }),
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      toast.error(j.error ?? t("saveError"));
      return;
    }
    toast.success(t("saved"));
    if (locale !== me.preferredLocale && pathname) {
      const newPath = pathname.replace(/^\/[a-zA-Z-]+/, `/${locale}`);
      router.push(newPath);
    } else {
      router.refresh();
    }
  }

  return (
    <SettingsCard
      icon={<User size={16} />}
      title={t("title")}
      description={t("description")}
      action={
        <button type="button" onClick={save} disabled={!dirty || saving} className="btn-primary">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {t("save")}
        </button>
      }
    >
      <FieldRow>
        <Field label={t("nameLabel")} htmlFor="me-name">
          <input
            id="me-name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            maxLength={80}
            className="input"
          />
        </Field>
        <Field label={t("emailLabel")} htmlFor="me-email" hint={t("emailHint")}>
          <input
            id="me-email"
            name="email"
            value={me.email}
            readOnly
            className="input cursor-not-allowed opacity-60"
          />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label={t("localeLabel")} htmlFor="me-locale">
          <select
            id="me-locale"
            name="locale"
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            className="input"
          >
            {LOCALES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
      </FieldRow>

      {/* 2FA */}
      <details className="rounded-lg border border-line bg-card p-3">
        <summary className="cursor-pointer text-xs font-medium text-body">
          {t("twoFactorTitle")}
          {me.twoFactorEnabled && (
            <span className="ml-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">
              {t("twoFactorActive")}
            </span>
          )}
        </summary>
        <div className="mt-3">
          <TwoFactorSection enabled={Boolean(me.twoFactorEnabled)} />
        </div>
      </details>

      {/* GDPR delete account */}
      <details className="rounded-lg border border-red-500/20 bg-red-500/[0.03] p-3">
        <summary className="cursor-pointer text-xs font-medium text-red-700 dark:text-red-300">
          {t("deleteAccountTitle")}
        </summary>
        <p className="mt-2 text-[11px] text-muted">{t("deleteAccountDescription")}</p>
        <button type="button" onClick={() => setDeleteOpen(true)} className="btn-danger mt-2">
          <Trash2 className="h-3.5 w-3.5" />
          {t("deleteAccountButton")}
        </button>
      </details>

      {deleteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeleteOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-red-500/30 bg-surface p-5 shadow-2xl">
            <div className="mb-3 flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-red-600 dark:text-red-400" />
              <div>
                <h3
                  id="delete-account-title"
                  className="text-sm font-semibold text-red-600 dark:text-red-400"
                >
                  {t("deleteModalTitle")}
                </h3>
                <p className="mt-1 text-xs text-muted">{t("deleteModalDescription")}</p>
              </div>
            </div>
            <code className="block rounded-lg border border-line bg-surface px-3 py-2 text-center font-mono text-sm text-strong">
              {me.email}
            </code>
            <input
              type="email"
              autoComplete="off"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={t("deleteEmailPlaceholder")}
              className="input mt-3 font-mono"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteOpen(false)} className="btn-secondary">
                {t("cancel")}
              </button>
              <button
                type="button"
                disabled={deleteConfirm.toLowerCase() !== me.email.toLowerCase() || deleting}
                onClick={async () => {
                  setDeleting(true);
                  const r = await fetch(`/api/me/delete?confirm=${encodeURIComponent(me.email)}`, {
                    method: "DELETE",
                  });
                  setDeleting(false);
                  if (r.ok) {
                    toast.success(t("deleted"));
                    setTimeout(() => {
                      window.location.href = "/auth/login";
                    }, 800);
                  } else {
                    const j = await r.json().catch(() => ({}));
                    toast.error(j.error ?? t("deleteError"));
                  }
                }}
                className="btn-danger"
              >
                {deleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                {t("deleteConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </SettingsCard>
  );
}
