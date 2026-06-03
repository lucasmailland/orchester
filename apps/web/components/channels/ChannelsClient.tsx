"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Globe,
  MessageCircle,
  Send,
  MessagesSquare,
  Mail,
  Webhook,
  Plus,
  Copy,
  Check,
  Loader2,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { NoProviderBanner } from "@/components/common/NoProviderBanner";
import { PageHero } from "@/components/compass/PageHero";
import { EmptyState } from "@/components/compass/EmptyState";
import { TermDef } from "@/components/compass/TermDef";
import { Callout } from "@/components/compass/Callout";
import { ConfirmAction } from "@/components/compass/ConfirmAction";
import { NextStep, NextStepGroup } from "@/components/compass/NextStep";

type ChannelType = "widget" | "telegram" | "slack" | "whatsapp" | "email" | "api" | "web";

interface Channel {
  id: string;
  name: string;
  type: string;
  status: string;
  agentId: string | null;
  secret: string | null;
  hasCredentials: boolean;
  config: Record<string, unknown>;
}
interface Agent {
  id: string;
  name: string;
  status: string;
}

const TYPE_ICONS: Record<ChannelType, typeof Globe> = {
  widget: Globe,
  web: Globe,
  telegram: Send,
  whatsapp: MessageCircle,
  slack: MessagesSquare,
  email: Mail,
  api: Webhook,
};
const TYPE_SUPPORTED: Record<ChannelType, boolean> = {
  widget: true,
  web: true,
  telegram: true,
  whatsapp: false,
  slack: false,
  email: false,
  api: true,
};

export function ChannelsClient({ channels, agents }: { channels: Channel[]; agents: Agent[] }) {
  const router = useRouter();
  const t = useTranslations("pages.channels");
  const tHero = useTranslations("compass.channels");
  const tEmpty = useTranslations("compass.empty.channels");
  const locale = useLocale();
  const params = useParams<{ workspaceSlug: string }>();
  const workspaceSlug = params?.workspaceSlug ?? "";

  const [creating, setCreating] = useState<ChannelType | null>(null);
  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState<string>(agents[0]?.id ?? "");
  const [pendingDelete, setPendingDelete] = useState<Channel | null>(null);
  const [deleting, setDeleting] = useState(false);

  function typeMeta(typeKey: ChannelType) {
    return {
      label: t(`types.${typeKey}.label`),
      description: t(`types.${typeKey}.description`),
      Icon: TYPE_ICONS[typeKey],
      supported: TYPE_SUPPORTED[typeKey],
    };
  }

  async function create(type: ChannelType) {
    if (!name.trim()) return toast.error(t("nameRequired"));
    if (!agentId) return toast.error(t("agentRequired"));
    const r = await fetch("/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, type, agentId }),
    });
    if (r.ok) {
      toast.success(t("channelCreated"));
      setCreating(null);
      setName("");
      router.refresh();
    } else {
      toast.error(t("createError"));
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/channels/${pendingDelete.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast.success(t("deleted"));
      setPendingDelete(null);
      router.refresh();
    } catch {
      toast.error(t("saveError"));
    } finally {
      setDeleting(false);
    }
  }

  const heroSubtitle = (
    <>
      {tHero("heroSubtitlePart1")}
      <TermDef term="channel">{tHero("heroSubtitleTermChannel")}</TermDef>
      {tHero("heroSubtitlePart2")}
      <TermDef term="agent">{tHero("heroSubtitleTermAgent")}</TermDef>
      {tHero("heroSubtitlePart3")}
    </>
  );

  const isEmpty = channels.length === 0;
  const pendingAgentName = pendingDelete
    ? (agents.find((a) => a.id === pendingDelete.agentId)?.name ?? tHero("noAgentAssigned"))
    : "";
  const pendingTypeLabel = pendingDelete
    ? (pendingDelete.type as ChannelType) in TYPE_ICONS
      ? t(`types.${pendingDelete.type as ChannelType}.label`)
      : pendingDelete.type
    : "";

  return (
    <div className="space-y-8">
      <NoProviderBanner />

      <PageHero icon={<Globe />} title={tHero("heroTitle")} subtitle={heroSubtitle} />

      {isEmpty ? (
        <EmptyState
          icon={<Globe className="h-5 w-5" />}
          title={tEmpty("title")}
          body={tEmpty("body")}
        />
      ) : null}

      <Callout variant="tip" title={tHero("tipTitle")}>
        {tHero("tipBody")}
      </Callout>

      <section aria-labelledby="channels-available-heading" className="space-y-3">
        <h2
          id="channels-available-heading"
          className="text-sm font-semibold uppercase tracking-wide text-muted"
        >
          {tHero("availableHeading")}
        </h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(TYPE_ICONS) as ChannelType[])
            .filter((typeKey) => typeKey !== "web")
            .map((typeKey) => {
              const meta = typeMeta(typeKey);
              return (
                <div key={typeKey} className="rounded-2xl border border-line bg-card p-4">
                  <div className="mb-3 flex items-center gap-2.5">
                    <div
                      className={
                        meta.supported
                          ? "flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400"
                          : "flex h-9 w-9 items-center justify-center rounded-xl bg-elevated text-muted"
                      }
                    >
                      <meta.Icon className="h-4 w-4" />
                    </div>
                    <div className="font-medium text-strong">{meta.label}</div>
                    {!meta.supported && (
                      <span className="ml-auto rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-300">
                        {t("beta")}
                      </span>
                    )}
                  </div>
                  <p className="text-xs leading-relaxed text-muted">{meta.description}</p>
                  <button
                    type="button"
                    disabled={!meta.supported}
                    onClick={() => setCreating(typeKey)}
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-elevated py-2 text-xs text-body hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" /> {t("connect", { label: meta.label })}
                  </button>
                </div>
              );
            })}
        </div>
      </section>

      {creating && (
        <div className="space-y-2 rounded-2xl border border-violet-500/30 bg-card p-4">
          <div className="text-sm font-medium text-strong">
            {t("newChannel", { label: typeMeta(creating).label })}
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            className="w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-strong outline-none focus:border-violet-500/60"
          />
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-strong outline-none focus:border-violet-500/60"
          >
            <option value="">{t("selectAgent")}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} {a.status === "active" ? "" : `(${a.status})`}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => create(creating)}
              className="rounded-lg bg-violet-500 px-3 py-1.5 text-xs text-white hover:bg-violet-400"
            >
              {t("create")}
            </button>
            <button
              type="button"
              onClick={() => setCreating(null)}
              className="text-xs text-muted hover:text-body"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}

      {channels.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-body">{t("connectedHeading")}</h2>
          <div className="space-y-2">
            {channels.map((c) => (
              <ConnectedChannelRow
                key={c.id}
                channel={c}
                agents={agents}
                onRequestDelete={() => setPendingDelete(c)}
              />
            ))}
          </div>
        </div>
      )}

      <section
        aria-labelledby="channels-next-steps"
        className="space-y-3 border-t border-line pt-8"
      >
        <h2
          id="channels-next-steps"
          className="text-sm font-semibold uppercase tracking-wide text-muted"
        >
          {tHero("nextStepsTitle")}
        </h2>
        <NextStepGroup className="lg:grid-cols-2">
          <NextStep
            icon={<Settings2 className="h-4 w-4" />}
            href={`/${locale}/${workspaceSlug}/agents`}
            title={tHero("nextStepConfigureAgent.title")}
            body={tHero("nextStepConfigureAgent.body")}
          />
          <NextStep
            icon={<MessagesSquare className="h-4 w-4" />}
            href={`/${locale}/${workspaceSlug}/conversations`}
            title={tHero("nextStepReviewConversations.title")}
            body={tHero("nextStepReviewConversations.body")}
          />
        </NextStepGroup>
      </section>

      <ConfirmAction
        open={pendingDelete !== null}
        onClose={() => {
          if (deleting) return;
          setPendingDelete(null);
        }}
        title={tHero("deleteTitle")}
        description={tHero("deleteDescription")}
        action={tHero("deleteAction")}
        cancelLabel={tHero("deleteCancel")}
        tone="destructive"
        isPending={deleting}
        impact={
          pendingDelete
            ? [
                {
                  label: tHero("deleteImpactChannel"),
                  value: pendingDelete.name || tHero("unknownValue"),
                },
                {
                  label: tHero("deleteImpactType"),
                  value: pendingTypeLabel || tHero("unknownValue"),
                },
                {
                  label: tHero("deleteImpactStatus"),
                  value: pendingDelete.status || tHero("unknownValue"),
                },
                {
                  label: tHero("deleteImpactAgent"),
                  value: pendingAgentName,
                },
                {
                  label: tHero("deleteImpactReversibility"),
                  value: tHero("deleteImpactReversibilityValue"),
                },
              ]
            : []
        }
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function ConnectedChannelRow({
  channel,
  agents,
  onRequestDelete,
}: {
  channel: Channel;
  agents: Agent[];
  onRequestDelete: () => void;
}) {
  const router = useRouter();
  const t = useTranslations("pages.channels");
  const channelType =
    (channel.type as ChannelType) in TYPE_ICONS ? (channel.type as ChannelType) : "api";
  const MetaIcon = TYPE_ICONS[channelType];
  const channelLabel = t(`types.${channelType}.label`);
  const [expanded, setExpanded] = useState(false);
  const [credInput, setCredInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [agentId, setAgentId] = useState(channel.agentId ?? "");
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    toast.success(t("copied"));
    setTimeout(() => setCopied(null), 1500);
  }

  async function saveCreds() {
    if (channel.type === "telegram" && !credInput.trim()) {
      return toast.error(t("tokenRequired"));
    }
    setSaving(true);
    const credentials =
      channel.type === "telegram" ? { botToken: credInput.trim() } : { token: credInput.trim() };
    const r = await fetch(`/api/channels/${channel.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credentials }),
    });
    setSaving(false);
    const j = await r.json();
    if (r.ok) {
      if (j.error) toast.error(j.error);
      else if (j.webhookSet) toast.success(t("webhookSet", { username: j.botUsername }));
      else toast.success(t("credsSaved"));
      setCredInput("");
      router.refresh();
    } else {
      toast.error(t("saveError"));
    }
  }

  async function toggleStatus() {
    const next = channel.status === "active" ? "inactive" : "active";
    const r = await fetch(`/api/channels/${channel.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (r.ok) {
      toast.success(next === "active" ? t("channelActivated") : t("channelPaused"));
      router.refresh();
    }
  }

  async function updateAgent(id: string) {
    setAgentId(id);
    await fetch(`/api/channels/${channel.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: id }),
    });
    router.refresh();
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const embedSnippet = `<script src="${origin}/api/embed?c=${channel.id}" async></script>`;
  const telegramWebhookUrl = channel.secret
    ? `${origin}/api/channels/telegram/webhook/${channel.secret}`
    : "";
  const apiTriggerUrl = channel.secret ? `${origin}/api/widget/${channel.id}/messages` : "";

  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400">
          <MetaIcon className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium text-strong">{channel.name}</div>
          <div className="text-[11px] text-muted">
            {channelLabel} ·{" "}
            <span
              className={
                channel.status === "active"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-amber-600 dark:text-amber-400"
              }
            >
              {channel.status}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={toggleStatus}
          className="rounded-lg border border-line px-2.5 py-1 text-[11px] text-body hover:bg-hover"
        >
          {channel.status === "active" ? t("pause") : t("activate")}
        </button>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="rounded-lg border border-line px-2.5 py-1 text-[11px] text-body hover:bg-hover"
        >
          {expanded ? t("close") : t("configure")}
        </button>
        <button
          type="button"
          onClick={onRequestDelete}
          className="text-muted hover:text-red-600 dark:hover:text-red-400"
          aria-label={t("deleteConfirm")}
        >
          ✕
        </button>
      </div>

      {expanded && (
        <div className="mt-4 space-y-3 border-t border-line pt-4 text-xs">
          <div>
            <label className="block text-muted">{t("agentLabel")}</label>
            <select
              value={agentId}
              onChange={(e) => updateAgent(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-elevated px-2 py-1.5 text-strong outline-none"
            >
              <option value="">{t("noAgent")}</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {channel.type === "widget" && (
            <div>
              <label className="block text-muted">{t("snippetLabel")}</label>
              <div className="mt-1 flex items-center gap-2 rounded-lg border border-line bg-black/40 p-2">
                <pre className="flex-1 overflow-x-auto font-mono text-[11px] text-body">
                  {embedSnippet}
                </pre>
                <button
                  type="button"
                  onClick={() => copy(embedSnippet, "embed")}
                  className="text-muted hover:text-body"
                >
                  {copied === "embed" ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
              <p className="mt-1 text-[10px] text-faint">
                {t.rich("snippetHelp", {
                  tag: "</body>",
                  code: (chunks) => <code>{chunks}</code>,
                })}
              </p>
            </div>
          )}

          {channel.type === "telegram" && (
            <>
              <div>
                <label className="block text-muted">{t("telegramTokenLabel")}</label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="password"
                    value={credInput}
                    onChange={(e) => setCredInput(e.target.value)}
                    placeholder={
                      channel.hasCredentials
                        ? t("telegramReplacePlaceholder")
                        : t("telegramPlaceholder")
                    }
                    className="flex-1 rounded-lg border border-line bg-elevated px-2 py-1.5 font-mono text-strong outline-none focus:border-violet-500/60"
                  />
                  <button
                    type="button"
                    onClick={saveCreds}
                    disabled={saving || !credInput.trim()}
                    className="flex items-center gap-1 rounded-lg bg-violet-500 px-3 py-1.5 text-xs text-white hover:bg-violet-400 disabled:opacity-40"
                  >
                    {saving && <Loader2 className="h-3 w-3 animate-spin" />} {t("save")}
                  </button>
                </div>
              </div>
              {channel.hasCredentials && (
                <div>
                  <label className="block text-muted">{t("webhookLabel")}</label>
                  <div className="mt-1 flex items-center gap-2 rounded-lg border border-line bg-black/40 p-2">
                    <pre className="flex-1 overflow-x-auto font-mono text-[10px] text-body">
                      {telegramWebhookUrl}
                    </pre>
                    <button
                      type="button"
                      onClick={() => copy(telegramWebhookUrl, "webhook")}
                      className="text-muted hover:text-body"
                    >
                      {copied === "webhook" ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {channel.type === "api" && (
            <div>
              <label className="block text-muted">{t("apiEndpointLabel")}</label>
              <div className="mt-1 flex items-center gap-2 rounded-lg border border-line bg-black/40 p-2">
                <pre className="flex-1 overflow-x-auto font-mono text-[10px] text-body">
                  POST {apiTriggerUrl}
                </pre>
                <button
                  type="button"
                  onClick={() => copy(apiTriggerUrl, "api")}
                  className="text-muted hover:text-body"
                >
                  {copied === "api" ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
              <p className="mt-1 text-[10px] text-faint">
                {t("apiBodyHint")} <code>{`{ visitorId: string, text: string }`}</code>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
