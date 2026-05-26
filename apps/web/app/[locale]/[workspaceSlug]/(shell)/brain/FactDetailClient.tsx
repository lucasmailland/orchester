"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  Save,
  Trash2,
  RotateCcw,
  Pin,
  Calendar,
  Activity as ActivityIcon,
  Hash,
  ChevronDown,
  AlertCircle,
} from "lucide-react";
import { Button, Chip, Skeleton, Slider, Switch, Textarea, Input } from "@heroui/react";
import { notify } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  forgetFact,
  patchFact,
  restoreFact,
  useBrainFact,
  type Fact,
} from "@/lib/hooks/use-brain-facts";
import { CitationsList } from "@/components/brain/CitationsList";

const STATEMENT_MIN = 10;
const STATEMENT_MAX = 400;

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hour = Math.round(min / 60);
  if (hour < 24) return `${hour}h ago`;
  const day = Math.round(hour / 24);
  if (day < 7) return `${day}d ago`;
  const week = Math.round(day / 7);
  if (week < 4) return `${week}w ago`;
  const month = Math.round(day / 30);
  if (month < 12) return `${month}mo ago`;
  const year = Math.round(day / 365);
  return `${year}y ago`;
}

export interface FactDetailClientProps {
  factId: string;
}

export function FactDetailClient({ factId }: FactDetailClientProps) {
  const t = useTranslations("brain");
  const params = useParams<{ locale: string; workspaceSlug: string }>();
  const locale = params?.locale ?? "en";
  const ws = params?.workspaceSlug ?? "";

  const { fact, error, isLoading, mutate } = useBrainFact(factId);

  const [subject, setSubject] = useState("");
  const [statement, setStatement] = useState("");
  const [confidence, setConfidence] = useState(0.5);
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);

  useEffect(() => {
    if (!fact) return;
    setSubject(fact.subject);
    setStatement(fact.statement);
    setConfidence(fact.confidence ?? 0.5);
    setPinned(fact.pinned);
  }, [fact]);

  const dirty =
    fact !== null &&
    (subject !== fact.subject ||
      statement !== fact.statement ||
      confidence !== fact.confidence ||
      pinned !== fact.pinned);

  const valid =
    statement.length >= STATEMENT_MIN &&
    statement.length <= STATEMENT_MAX &&
    subject.trim().length > 0;

  async function handleSave() {
    if (!fact || !valid) return;
    setSaving(true);
    try {
      await patchFact(fact.id, { subject, statement, confidence, pinned });
      notify.success(t("toast.saved"));
      void mutate();
    } catch {
      notify.error(t("toast.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function handleForget(f: Fact) {
    try {
      await forgetFact(f.id);
      notify.success(t("toast.forgotten"));
      void mutate();
    } catch {
      notify.error(t("toast.forgetError"));
    }
  }

  async function handleRestore(f: Fact) {
    try {
      await restoreFact(f.id);
      notify.success(t("toast.restored"));
      void mutate();
    } catch {
      notify.error(t("toast.restoreError"));
    }
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-card p-12 text-center">
        <AlertCircle className="h-6 w-6 text-danger" />
        <p className="text-sm text-muted">{t("errors.loadFailed")}</p>
        <Button as={Link} href={`/${locale}/${ws}/brain`} size="sm" variant="flat">
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("detail.back")}
        </Button>
      </div>
    );
  }

  if (isLoading || !fact) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48 rounded-md" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  const forgotten = fact.status === "forgotten";

  return (
    <div className="space-y-6">
      {/* Top action bar */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            as={Link}
            href={`/${locale}/${ws}/brain`}
            variant="light"
            size="sm"
            startContent={<ArrowLeft className="h-3.5 w-3.5" />}
          >
            {t("detail.back")}
          </Button>
          <h1 className="ml-2 truncate font-display text-lg font-semibold text-strong">
            {fact.subject}
          </h1>
          {forgotten ? (
            <Chip size="sm" variant="flat" className="bg-zinc-500/15 text-muted">
              {t("filters.status_forgotten")}
            </Chip>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {forgotten ? (
            <Button
              color="success"
              variant="flat"
              size="sm"
              startContent={<RotateCcw className="h-3.5 w-3.5" />}
              onPress={() => handleRestore(fact)}
            >
              {t("actions.restore")}
            </Button>
          ) : (
            <Button
              color="danger"
              variant="flat"
              size="sm"
              startContent={<Trash2 className="h-3.5 w-3.5" />}
              onPress={() => handleForget(fact)}
            >
              {t("actions.forget")}
            </Button>
          )}
          <Button
            color="primary"
            size="sm"
            startContent={<Save className="h-3.5 w-3.5" />}
            isDisabled={!dirty || !valid}
            isLoading={saving}
            onPress={handleSave}
          >
            {t("actions.save")}
          </Button>
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Editable fact */}
        <section className="md:col-span-2 space-y-4">
          <div className="rounded-2xl border border-line bg-card p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
              {t("detail.fact")}
            </h2>
            <div className="mt-3 space-y-4">
              <Input
                label={t("detail.subject")}
                value={subject}
                onValueChange={setSubject}
                size="sm"
                isRequired
              />
              <Textarea
                label={t("detail.statement")}
                value={statement}
                onValueChange={setStatement}
                minRows={3}
                maxRows={8}
                isInvalid={
                  statement.length > 0 &&
                  (statement.length < STATEMENT_MIN || statement.length > STATEMENT_MAX)
                }
                description={t("detail.characterCount", {
                  used: statement.length,
                  max: STATEMENT_MAX,
                })}
              />
              <div className="grid gap-4 md:grid-cols-2">
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
                <div className="flex items-end">
                  <Switch size="sm" isSelected={pinned} onValueChange={setPinned}>
                    <span className="ml-1 text-xs text-body inline-flex items-center gap-1">
                      <Pin className="h-3 w-3" />
                      {t("detail.pinned")}
                    </span>
                  </Switch>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
                <Chip size="sm" variant="flat" className="bg-elevated text-[10px] uppercase">
                  {t("detail.kind")}: {fact.kind}
                </Chip>
                <Chip size="sm" variant="flat" className="bg-elevated text-[10px] uppercase">
                  {t("detail.scope")}: {fact.scope}
                </Chip>
                {fact.scopeRef ? (
                  <Chip size="sm" variant="flat" className="bg-elevated text-[10px]">
                    scopeRef: <code className="ml-1 font-mono">{fact.scopeRef.slice(0, 12)}…</code>
                  </Chip>
                ) : null}
              </div>
            </div>
          </div>

          {/* Citations */}
          <div id="citations" className="rounded-2xl border border-line bg-card p-5">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
              {t("detail.citations")}
            </h2>
            <CitationsList factId={fact.id} />
          </div>

          {/* Metadata */}
          <div className="rounded-2xl border border-line bg-card p-5">
            <button
              type="button"
              onClick={() => setMetaOpen((v) => !v)}
              className="flex w-full items-center justify-between"
              aria-expanded={metaOpen}
            >
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                {t("detail.metadata")}
              </span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 text-muted transition-transform",
                  metaOpen && "rotate-180"
                )}
              />
            </button>
            {metaOpen ? (
              <pre className="mt-3 overflow-auto rounded-lg bg-elevated p-3 text-[11px] text-body">
                {JSON.stringify(fact.metadata ?? {}, null, 2)}
              </pre>
            ) : null}
          </div>
        </section>

        {/* Sidebar */}
        <aside className="space-y-4">
          <div className="rounded-2xl border border-line bg-card p-5">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
              {t("detail.activity")}
            </h2>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2 text-body">
                <ActivityIcon className="h-3.5 w-3.5 text-emerald-500" />
                {t("detail.recalledNTimes", { count: fact.hitCount })}
              </li>
              <li className="flex items-center gap-2 text-muted">
                <Calendar className="h-3.5 w-3.5 text-faint" />
                {fact.lastRecalledAt
                  ? t("detail.lastRecalled", { when: relativeTime(fact.lastRecalledAt) })
                  : t("detail.neverRecalled")}
              </li>
              <li className="flex items-center gap-2 text-muted">
                <Hash className="h-3.5 w-3.5 text-faint" />
                {t("detail.sourceCount", { count: fact.sourceMessageIds.length })}
              </li>
            </ul>
          </div>

          <div className="rounded-2xl border border-line bg-card p-5">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
              {t("detail.timestamps")}
            </h2>
            <dl className="space-y-2 text-[11px] text-muted">
              <div className="flex justify-between gap-2">
                <dt>{t("detail.createdAt")}</dt>
                <dd className="font-mono text-body" title={fact.createdAt}>
                  {relativeTime(fact.createdAt)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>{t("detail.updatedAt")}</dt>
                <dd className="font-mono text-body" title={fact.updatedAt}>
                  {relativeTime(fact.updatedAt)}
                </dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}
