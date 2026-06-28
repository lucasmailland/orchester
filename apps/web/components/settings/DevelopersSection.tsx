"use client";

import { useEffect, useState } from "react";
import { Key, Plus, Copy, Check, Trash2, Webhook as WebhookIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}
interface OutboundWebhook {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  lastDeliveredAt: string | null;
  lastError: string | null;
  failureCount: number;
}

const ALL_EVENTS = [
  "agent.responded",
  "flow.run.succeeded",
  "flow.run.failed",
  "conversation.created",
  "conversation.escalated",
  "kb.doc.indexed",
];

export function DevelopersSection() {
  const t = useTranslations("pages.settings.developers");
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [webhooks, setWebhooks] = useState<OutboundWebhook[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<{ id: string; key: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [newWhUrl, setNewWhUrl] = useState("");
  const [newWhEvents, setNewWhEvents] = useState<string[]>(["agent.responded"]);

  async function load() {
    const [k, w] = await Promise.all([
      fetch("/api/api-keys").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/webhooks-out").then((r) => (r.ok ? r.json() : [])),
    ]);
    setKeys(Array.isArray(k) ? k : []);
    setWebhooks(Array.isArray(w) ? w : []);
  }
  useEffect(() => {
    load();
  }, []);

  async function createKey() {
    if (!newKeyName.trim()) return;
    setCreating(true);
    const r = await fetch("/api/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newKeyName }),
    });
    setCreating(false);
    const j = await r.json();
    if (r.ok) {
      setRevealedKey({ id: j.id, key: j.key });
      setNewKeyName("");
      toast.success(t("keyCreated"));
      load();
    } else toast.error(j.error ?? t("createError"));
  }

  async function revokeKey(id: string) {
    if (!confirm(t("revokeKeyConfirm"))) return;
    const r = await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
    if (r.ok) {
      toast.success(t("keyRevoked"));
      load();
    }
  }

  async function copy(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    toast.success(t("copied"));
    setTimeout(() => setCopied(null), 1500);
  }

  async function createWebhook() {
    if (!newWhUrl.trim()) return;
    const r = await fetch("/api/webhooks-out", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: newWhUrl, events: newWhEvents }),
    });
    if (r.ok) {
      setNewWhUrl("");
      toast.success(t("webhookCreated"));
      load();
    }
  }

  async function toggleWebhook(id: string, enabled: boolean) {
    try {
      const r = await fetch(`/api/webhooks-out/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch {
      toast.error(t("saveError"));
    }
    load();
  }

  async function deleteWebhook(id: string) {
    if (!confirm(t("deleteWebhookConfirm"))) return;
    try {
      const r = await fetch(`/api/webhooks-out/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast.success(t("webhookDeleted"));
    } catch {
      toast.error(t("deleteError"));
    }
    load();
  }

  async function testWebhook(id: string) {
    const toastId = toast.loading(t("testingWebhook"));
    const r = await fetch(`/api/webhooks-out/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "test" }),
    });
    const j = await r.json();
    toast.dismiss(toastId);
    if (j.ok) toast.success(t("testWebhookOk"));
    else toast.error(j.error ?? t("testWebhookFailed"));
  }

  return (
    <div className="space-y-8">
      {/* API Keys */}
      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-body">
          <Key className="h-4 w-4 text-violet-600 dark:text-violet-400" /> {t("apiKeysHeading")}
        </h3>
        <div className="space-y-2 rounded-2xl border border-line bg-card p-4">
          {revealedKey && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
              <div className="mb-1 font-medium text-emerald-700 dark:text-emerald-200">
                {t("copyOnceWarning")}
              </div>
              <div className="flex items-center gap-2 rounded bg-black/40 p-2">
                <code className="flex-1 break-all font-mono text-[11px] text-body">
                  {revealedKey.key}
                </code>
                <button
                  type="button"
                  onClick={() => copy(revealedKey.key, "key")}
                  className="text-muted hover:text-strong"
                >
                  {copied === "key" ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setRevealedKey(null)}
                className="mt-2 text-[10px] text-emerald-200/70 hover:text-emerald-200"
              >
                {t("saved")}
              </button>
            </div>
          )}

          {keys.length === 0 && <p className="text-xs text-muted">{t("noApiKeys")}</p>}
          {keys.map((k) => (
            <div
              key={k.id}
              className="flex items-center justify-between rounded-lg border border-line bg-elevated px-3 py-2 text-xs"
            >
              <div>
                <div className="flex items-center gap-2 text-strong">
                  <span className="font-medium">{k.name}</span>
                  {k.revokedAt && (
                    <span className="rounded-md bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-700 dark:text-red-300">
                      {t("revoked")}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-muted">
                  {k.prefix} ·{" "}
                  {k.lastUsedAt
                    ? t("lastUsed", { date: new Date(k.lastUsedAt).toLocaleDateString() })
                    : t("neverUsed")}
                </div>
              </div>
              {!k.revokedAt && (
                <button
                  type="button"
                  onClick={() => revokeKey(k.id)}
                  className="text-muted hover:text-red-600 dark:hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}

          <div className="mt-2 flex items-center gap-2 border-t border-line pt-3">
            <label htmlFor="api-key-name" className="sr-only">
              {t("keyNameAria")}
            </label>
            <input
              id="api-key-name"
              name="api-key-name"
              autoComplete="off"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder={t("keyNamePlaceholder")}
              className="flex-1 rounded-lg border border-line bg-elevated px-3 py-1.5 text-xs text-strong outline-none focus:border-violet-500/60"
            />
            <button
              type="button"
              onClick={createKey}
              disabled={creating || !newKeyName.trim()}
              className="flex items-center gap-1 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-40"
            >
              {creating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Plus className="h-3 w-3" />
              )}{" "}
              {t("createKey")}
            </button>
          </div>
        </div>
      </div>

      {/* Outbound webhooks */}
      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-body">
          <WebhookIcon className="h-4 w-4 text-amber-600 dark:text-amber-400" />{" "}
          {t("webhooksHeading")}
        </h3>
        <div className="space-y-2 rounded-2xl border border-line bg-card p-4">
          {webhooks.length === 0 && <p className="text-xs text-muted">{t("noWebhooks")}</p>}
          {webhooks.map((w) => (
            <div
              key={w.id}
              className="space-y-1.5 rounded-lg border border-line bg-elevated px-3 py-2 text-xs"
            >
              <div className="flex items-center justify-between">
                <code className="break-all font-mono text-body">{w.url}</code>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => testWebhook(w.id)}
                    className="rounded-md border border-line px-2 py-0.5 text-[10px] text-body hover:bg-hover"
                  >
                    {t("test")}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleWebhook(w.id, !w.enabled)}
                    className={
                      w.enabled
                        ? "rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300"
                        : "rounded-md bg-zinc-700/50 px-2 py-0.5 text-[10px] text-muted"
                    }
                  >
                    {w.enabled ? t("active") : t("paused")}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteWebhook(w.id)}
                    className="text-muted hover:text-red-600 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {w.events.map((e) => (
                  <span
                    key={e}
                    className="rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-700 dark:text-violet-300"
                  >
                    {e}
                  </span>
                ))}
              </div>
              {w.lastError && (
                <div className="text-[10px] text-red-600 dark:text-red-400">⚠ {w.lastError}</div>
              )}
            </div>
          ))}
          <div className="space-y-2 border-t border-line pt-3">
            <label htmlFor="webhook-url" className="sr-only">
              {t("urlAria")}
            </label>
            <input
              id="webhook-url"
              name="webhook-url"
              type="url"
              value={newWhUrl}
              onChange={(e) => setNewWhUrl(e.target.value)}
              placeholder={t("urlPlaceholder")}
              className="w-full rounded-lg border border-line bg-elevated px-3 py-1.5 font-mono text-xs text-strong outline-none focus:border-violet-500/60"
            />
            <div className="flex flex-wrap gap-1">
              {ALL_EVENTS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() =>
                    setNewWhEvents((curr) =>
                      curr.includes(e) ? curr.filter((x) => x !== e) : [...curr, e]
                    )
                  }
                  className={
                    newWhEvents.includes(e)
                      ? "rounded-md bg-violet-500/25 px-2 py-1 text-[10px] text-violet-700 dark:text-violet-200"
                      : "rounded-md border border-line px-2 py-1 text-[10px] text-muted hover:text-body"
                  }
                >
                  {e}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={createWebhook}
              disabled={!newWhUrl.trim() || newWhEvents.length === 0}
              className="rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-40"
            >
              {t("addWebhook")}
            </button>
          </div>
        </div>
      </div>

      {/* Public API docs hint */}
      <div className="rounded-2xl border border-line bg-card p-4 text-xs text-muted">
        💡 {t("apiHint")}{" "}
        <code className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-body">
          Authorization: Bearer ok_live_...
        </code>{" "}
        →{" "}
        <code className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-body">
          /api/v1/agents
        </code>
        ,{" "}
        <code className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-body">
          /api/v1/flows
        </code>
        . Rate limit: 60 req/min.{" "}
        <a
          href="/api/v1/openapi.json"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline-offset-2 hover:underline"
        >
          OpenAPI spec ↗
        </a>
      </div>
    </div>
  );
}
