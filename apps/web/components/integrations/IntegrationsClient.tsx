"use client";

import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  Boxes,
  CreditCard,
  Database,
  FileText,
  Globe,
  Loader2,
  Mail,
  MessageSquare,
  Plug,
  Plus,
  RefreshCw,
  Trash2,
  X,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

interface ConnectorField {
  key: string;
  label: string;
  type: "text" | "password" | "url";
  placeholder?: string;
  required?: boolean;
  help?: string;
}
interface Connector {
  id: string;
  name: string;
  description: string;
  category: string;
  authType: string;
  needsOAuthApp: boolean;
  fields: ConnectorField[];
  actions: { key: string; description: string }[];
}
interface Configured {
  id: string;
  type: string;
  name: string;
  status: string;
  enabled: boolean;
  meta: Record<string, unknown> | null;
  lastError: string | null;
}

const ICONS: Record<string, typeof Database> = {
  stripe: CreditCard,
  notion: FileText,
  postgres: Database,
  resend: Mail,
  http: Globe,
  slack: MessageSquare,
  google: Boxes,
};

export function IntegrationsClient() {
  const t = useTranslations("pages.integrations");
  const [catalog, setCatalog] = useState<Connector[]>([]);
  const [configured, setConfigured] = useState<Configured[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ connector: Connector; editId?: string } | null>(null);

  async function load() {
    const r = await fetch("/api/integrations");
    if (r.ok) {
      const j = await r.json();
      setCatalog(j.catalog ?? []);
      setConfigured(j.configured ?? []);
    }
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function test(id: string) {
    const toastId = toast.loading(t("testing"));
    const r = await fetch(`/api/integrations/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "test" }),
    });
    const j = await r.json();
    toast.dismiss(toastId);
    if (j.ok) toast.success(t("connectionOk"));
    else toast.error(j.error ?? t("connectionFailed"));
    load();
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(t("deleteConfirm", { name }))) return;
    try {
      const r = await fetch(`/api/integrations/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast.success(t("deleted"));
    } catch {
      toast.error(t("deleteError"));
    }
    load();
  }

  if (loading) return <Loader2 className="h-5 w-5 animate-spin text-muted" />;

  const configuredByType = new Set(configured.map((c) => c.type));

  return (
    <div className="space-y-6">
      {/* Configured */}
      {configured.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-body">{t("connectedHeading")}</h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {configured.map((c) => {
              const Icon = ICONS[c.type] ?? Plug;
              const conn = catalog.find((k) => k.id === c.type);
              return (
                <div key={c.id} className="rounded-2xl border border-line bg-card p-4">
                  <div className="mb-2 flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15 text-violet-700 dark:text-violet-300">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-strong">{c.name}</div>
                      <div className="text-[10px] text-muted">{conn?.name ?? c.type}</div>
                    </div>
                    {c.status === "connected" ? (
                      <span className="flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="h-2.5 w-2.5" /> OK
                      </span>
                    ) : c.status === "error" ? (
                      <span className="flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-700 dark:text-rose-300">
                        <AlertCircle className="h-2.5 w-2.5" /> Error
                      </span>
                    ) : (
                      <span className="rounded-md border border-line px-1.5 py-0.5 text-[10px] text-muted">
                        {t("untested")}
                      </span>
                    )}
                  </div>
                  {c.lastError && (
                    <p className="mb-2 line-clamp-2 text-[11px] text-rose-400/80">{c.lastError}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => test(c.id)}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-line py-1.5 text-xs text-body hover:bg-hover"
                    >
                      <RefreshCw className="h-3 w-3" /> {t("test")}
                    </button>
                    {conn && (
                      <button
                        type="button"
                        onClick={() => setModal({ connector: conn, editId: c.id })}
                        className="rounded-lg border border-line px-3 py-1.5 text-xs text-body hover:bg-hover"
                      >
                        {t("edit")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => remove(c.id, c.name)}
                      aria-label={t("removeAria", { name: c.name })}
                      className="rounded-lg border border-line px-2 py-1.5 text-muted hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Catalog */}
      <div>
        <h2 className="mb-2 text-sm font-medium text-body">{t("availableHeading")}</h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {catalog.map((c) => {
            const Icon = ICONS[c.id] ?? Plug;
            const already = configuredByType.has(c.id);
            return (
              <div
                key={c.id}
                className="flex h-full flex-col rounded-2xl border border-line bg-card p-4"
              >
                <div className="mb-2 flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="font-medium text-strong">{c.name}</div>
                  {c.needsOAuthApp && (
                    <span className="ml-auto rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                      OAuth
                    </span>
                  )}
                </div>
                <p className="flex-1 text-xs leading-relaxed text-muted">{c.description}</p>
                {c.actions.length > 0 && (
                  <p className="mt-2 text-[10px] text-faint">
                    {c.actions.length === 1
                      ? t("actionsCountOne", { count: c.actions.length })
                      : t("actionsCount", { count: c.actions.length })}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setModal({ connector: c })}
                  className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 py-2 text-xs font-medium text-violet-700 dark:text-violet-300 hover:bg-violet-500/20"
                >
                  <Plus className="h-3 w-3" /> {already ? t("addAnother") : t("connect")}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <p className="rounded-xl border border-line bg-card p-4 text-xs text-muted">
        {t.rich("footer", { b: (chunks) => <strong>{chunks}</strong> })}
      </p>

      {modal && (
        <ConfigModal
          connector={modal.connector}
          editId={modal.editId}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function ConfigModal({
  connector,
  editId,
  onClose,
  onSaved,
}: {
  connector: Connector;
  editId?: string | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("pages.integrations");
  const [name, setName] = useState(connector.name);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // a11y-006: stable ids so `<label htmlFor>` and `aria-labelledby`
  // wire up correctly across renders.
  const titleId = useId();
  const nameId = useId();
  // The per-field ids are derived from a single base + the field key so
  // each `<input>` matches its sibling `<label>` exactly.
  const fieldsBase = useId();

  // a11y-006: Escape closes the modal. Mirrors the backdrop click.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    for (const f of connector.fields) {
      if (f.required && !config[f.key]?.trim()) {
        toast.error(t("fieldRequired", { label: f.label }));
        return;
      }
    }
    setBusy(true);
    const url = editId ? `/api/integrations/${editId}` : "/api/integrations";
    const r = await fetch(url, {
      method: editId ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: connector.id, name, config }),
    });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) {
      toast.error(j.error ?? t("saveError"));
      return;
    }
    if (j.status === "connected") toast.success(t("connectedOk"));
    else toast.warning(t("savedButFailed", { error: j.error ?? "" }));
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-md rounded-2xl border border-line bg-surface p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 id={titleId} className="font-display text-lg font-semibold text-strong">
            {t("connectTitle", { name: connector.name })}
          </h3>
          <button
            onClick={onClose}
            type="button"
            aria-label={t("close")}
            className="text-muted hover:text-body"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {connector.needsOAuthApp && (
          <p className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
            {t("oauthNote")}
          </p>
        )}
        <div className="space-y-3">
          <div>
            <label htmlFor={nameId} className="mb-1 block text-xs text-muted">
              {t("nameLabel")}
            </label>
            <input
              id={nameId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-strong outline-none focus:border-violet-500/60"
            />
          </div>
          {connector.fields.map((f) => {
            const fieldId = `${fieldsBase}-${f.key}`;
            return (
              <div key={f.key}>
                <label htmlFor={fieldId} className="mb-1 block text-xs text-muted">
                  {f.label}
                  {f.required && <span className="text-rose-600 dark:text-rose-400"> *</span>}
                </label>
                <input
                  id={fieldId}
                  type={f.type === "password" ? "password" : "text"}
                  placeholder={f.placeholder}
                  value={config[f.key] ?? ""}
                  onChange={(e) => setConfig((p) => ({ ...p, [f.key]: e.target.value }))}
                  className="w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-strong placeholder:text-faint outline-none focus:border-violet-500/60"
                />
                {f.help && <p className="mt-1 text-[10px] text-faint">{f.help}</p>}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-violet-500 py-2 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("saveAndTest")}
        </button>
      </div>
    </div>
  );
}
