"use client";

/**
 * Compass Command Bar — Cmd-K / Ctrl-K.
 *
 * Search across agents, flows, conversations, knowledge bases, docs (COMPASS_TERMS),
 * tours, and quick actions. Lazy fetch on open. cmdk handles the fuzzy match —
 * it's already a dep (no new bundle weight) and matches the project convention.
 *
 * Selecting a doc opens its long definition in an embedded side panel without
 * leaving the bar. Tours dispatch `compass:tour`. Everything else navigates.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Command } from "cmdk";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import {
  Bot,
  BookOpen,
  Brain,
  Compass,
  FileText,
  History,
  type LucideIcon,
  MessageSquare,
  Moon,
  PlayCircle,
  Plus,
  Search,
  Sparkles,
  Workflow,
  X,
} from "lucide-react";
import {
  COMPASS_TERMS,
  type CompassLocale,
  type CompassTermKey,
  getTermLong,
  getTermShort,
} from "@/lib/compass/terms";

// ───────────────────────────────────────────────────────────── Types

type ResourceKind = "agent" | "flow" | "kb" | "conversation";
type QuickActionId =
  | "createAgent"
  | "createFlow"
  | "runMemoryHousekeeping"
  | "openOnboarding"
  | "toggleTheme"
  | "openBrain";
type TourId = "memory-ops" | "brain-inspector" | "flows" | "knowledgeBases";

export type CommandResult =
  | {
      kind: "resource";
      resource: ResourceKind;
      id: string;
      title: string;
      hint?: string;
    }
  | {
      kind: "action";
      actionId: QuickActionId;
      title: string;
      hint?: string;
    }
  | {
      kind: "doc";
      termKey: CompassTermKey;
      title: string;
      hint?: string;
    }
  | {
      kind: "tour";
      tourId: TourId;
      title: string;
      hint?: string;
    };

// ───────────────────────────────────────────────────── Fetchers

/**
 * Abortable JSON fetcher for SWR. On HTTP error or network failure we resolve
 * to an empty array so the CommandBar degrades gracefully instead of throwing.
 * SWR passes its own AbortSignal in `arg.signal`, which lets a re-rendered or
 * unmounted bar cancel in-flight requests instead of just dropping their
 * results.
 */
async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  try {
    const r = await fetch(url, { credentials: "same-origin", ...init });
    if (!r.ok) return [];
    return (await r.json()) as unknown;
  } catch {
    return [];
  }
}

function pickList<T>(raw: unknown, map: (row: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map(map);
}

function pickRowsList<T>(raw: unknown, map: (row: Record<string, unknown>) => T): T[] {
  const rows =
    raw && typeof raw === "object" && Array.isArray((raw as { rows?: unknown[] }).rows)
      ? (raw as { rows: unknown[] }).rows
      : [];
  return rows
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map(map);
}

/** SWR config shared by every resource hook — 5 min dedupe, no refocus chatter. */
const SWR_CFG = {
  dedupingInterval: 300_000,
  revalidateOnFocus: false,
  revalidateIfStale: false,
} as const;

// ───────────────────────────────────────────────────── Constants

const RECENTS_KEY = "compass.commandBar.recent";
const RECENTS_MAX = 5;
/** Defensive per-section cap. Above this, render the first N and surface an
 *  overflow notice so users know to narrow their query. Real workspaces won't
 *  hit this — virtualization is a Sprint-7 concern if it ever surfaces. */
const SECTION_SOFT_CAP = 200;

const QUICK_ACTIONS: ReadonlyArray<{ id: QuickActionId; labelKey: string; Icon: LucideIcon }> = [
  { id: "createAgent", labelKey: "quickActions.createAgent", Icon: Plus },
  { id: "createFlow", labelKey: "quickActions.createFlow", Icon: Workflow },
  { id: "runMemoryHousekeeping", labelKey: "quickActions.runMemoryHousekeeping", Icon: Sparkles },
  { id: "openOnboarding", labelKey: "quickActions.openOnboarding", Icon: Compass },
  { id: "toggleTheme", labelKey: "quickActions.toggleTheme", Icon: Moon },
  { id: "openBrain", labelKey: "quickActions.openBrain", Icon: Brain },
] as const;

const TOURS: ReadonlyArray<{ id: TourId; labelKey: string }> = [
  { id: "memory-ops", labelKey: "tours.memoryOps" },
  { id: "brain-inspector", labelKey: "tours.brainInspector" },
  { id: "flows", labelKey: "tours.flows" },
  { id: "knowledgeBases", labelKey: "tours.knowledgeBases" },
] as const;

// ───────────────────────────────────────────────────── Recents

interface RecentEntry {
  /** Stable identity for the result (e.g. `agent:<uuid>`, `doc:embedding`, `action:createAgent`). */
  key: string;
  /** Cached display title (we keep it so deleted resources still render until the user clicks). */
  title: string;
  /** Cached snapshot of the original result for instant re-execution. */
  result: CommandResult;
}

function readRecents(): RecentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, RECENTS_MAX).filter((e): e is RecentEntry => {
      return (
        typeof e === "object" &&
        e !== null &&
        typeof (e as RecentEntry).key === "string" &&
        typeof (e as RecentEntry).title === "string" &&
        typeof (e as RecentEntry).result === "object"
      );
    });
  } catch {
    return [];
  }
}

function pushRecent(entry: RecentEntry) {
  if (typeof window === "undefined") return;
  try {
    const current = readRecents().filter((e) => e.key !== entry.key);
    const next = [entry, ...current].slice(0, RECENTS_MAX);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* localStorage may be disabled — fail silent */
  }
}

function resultKey(r: CommandResult): string {
  switch (r.kind) {
    case "resource":
      return `${r.resource}:${r.id}`;
    case "action":
      return `action:${r.actionId}`;
    case "doc":
      return `doc:${r.termKey}`;
    case "tour":
      return `tour:${r.tourId}`;
  }
}

// ───────────────────────────────────────────────────── Icon map

const RESOURCE_ICON: Record<ResourceKind, LucideIcon> = {
  agent: Bot,
  flow: Workflow,
  kb: BookOpen,
  conversation: MessageSquare,
};

function iconFor(r: CommandResult): LucideIcon {
  switch (r.kind) {
    case "resource":
      return RESOURCE_ICON[r.resource];
    case "action": {
      const found = QUICK_ACTIONS.find((q) => q.id === r.actionId);
      return found?.Icon ?? Sparkles;
    }
    case "doc":
      return FileText;
    case "tour":
      return PlayCircle;
  }
}

// ───────────────────────────────────────────────────── Component

interface CommandBarProps {
  /** Optional controls — by default the bar manages its own visibility via Cmd-K. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CommandBar({ open: controlledOpen, onOpenChange }: CommandBarProps = {}) {
  const t = useTranslations("compass.commandBar");
  const router = useRouter();
  const params = useParams<{ locale: string; workspaceSlug: string }>();
  const locale = (params?.locale ?? "es") as CompassLocale;
  const workspaceSlug = params?.workspaceSlug ?? "";

  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange]
  );

  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const [activeDoc, setActiveDoc] = useState<CompassTermKey | null>(null);
  const listboxId = useId();

  // ── SWR-backed resource fetches ──
  // Each hook fires only while the bar is open. SWR dedupes within
  // SWR_CFG.dedupingInterval (5 min) — rapid open/close no longer stampedes
  // the API. SWR also wires AbortSignal into its fetcher under the hood, so
  // an unmounted bar cancels its own in-flight requests.
  const agentsKey = open ? "/api/agents" : null;
  const flowsKey = open ? "/api/flows" : null;
  const kbsKey = open ? "/api/knowledge-bases" : null;
  const convKey = open ? "/api/conversations?limit=50" : null;

  const { data: agentsRaw } = useSWR(agentsKey, fetchJson, SWR_CFG);
  const { data: flowsRaw } = useSWR(flowsKey, fetchJson, SWR_CFG);
  const { data: kbsRaw } = useSWR(kbsKey, fetchJson, SWR_CFG);
  const { data: convRaw } = useSWR(convKey, fetchJson, SWR_CFG);

  const resources = useMemo(
    () => ({
      agents: pickList(agentsRaw, (a) => ({ id: String(a.id), name: String(a.name ?? "") })),
      flows: pickList(flowsRaw, (f) => ({ id: String(f.id), name: String(f.name ?? "") })),
      kbs: pickList(kbsRaw, (k) => ({ id: String(k.id), name: String(k.name ?? "") })),
      conversations: pickRowsList(convRaw, (c) => ({
        id: String(c.id),
        title: String(c.summary ?? c.customerName ?? c.customerEmail ?? c.id),
      })),
    }),
    [agentsRaw, flowsRaw, kbsRaw, convRaw]
  );

  // ── Cmd-K / Ctrl-K + Esc handler (8 lines as specified) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
      } else if (e.key === "Escape" && open) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  // ── Refresh recents whenever the bar opens ──
  useEffect(() => {
    if (open) setRecents(readRecents());
  }, [open]);

  // ── Build all candidate results (cmdk does the filtering/scoring) ──
  // Within each section we pre-sort by closest-prefix-match against the live
  // query, then alphabetical — so an exact-name lookup surfaces first instead
  // of getting buried at rank 9+ (the old `.slice(0, 8)` bug).
  const sortByRelevance = useCallback(<R extends { title: string }>(items: R[], q: string): R[] => {
    if (!q) return [...items].sort((a, b) => a.title.localeCompare(b.title));
    const needle = q.toLowerCase();
    return [...items].sort((a, b) => {
      const at = a.title.toLowerCase();
      const bt = b.title.toLowerCase();
      const aStarts = at.startsWith(needle);
      const bStarts = bt.startsWith(needle);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;
      return at.localeCompare(bt);
    });
  }, []);

  const results = useMemo(() => {
    const actions: CommandResult[] = QUICK_ACTIONS.map((a) => ({
      kind: "action" as const,
      actionId: a.id,
      title: t(a.labelKey),
    }));
    const agents: CommandResult[] = resources.agents.map((a) => ({
      kind: "resource" as const,
      resource: "agent",
      id: a.id,
      title: a.name,
    }));
    const flows: CommandResult[] = resources.flows.map((f) => ({
      kind: "resource" as const,
      resource: "flow",
      id: f.id,
      title: f.name,
    }));
    const kbs: CommandResult[] = resources.kbs.map((k) => ({
      kind: "resource" as const,
      resource: "kb",
      id: k.id,
      title: k.name,
    }));
    const conversations: CommandResult[] = resources.conversations.map((c) => ({
      kind: "resource" as const,
      resource: "conversation",
      id: c.id,
      title: c.title,
    }));
    const docs: CommandResult[] = (Object.keys(COMPASS_TERMS) as CompassTermKey[]).map((k) => ({
      kind: "doc" as const,
      termKey: k,
      title: k.charAt(0).toUpperCase() + k.slice(1),
      hint: getTermShort(k, locale),
    }));
    const tours: CommandResult[] = TOURS.map((tr) => ({
      kind: "tour" as const,
      tourId: tr.id,
      title: t(tr.labelKey),
    }));

    return {
      actions,
      agents: sortByRelevance(agents, query),
      flows: sortByRelevance(flows, query),
      kbs: sortByRelevance(kbs, query),
      conversations: sortByRelevance(conversations, query),
      docs,
      tours,
    };
  }, [resources, t, locale, query, sortByRelevance]);

  // ── Selection ──
  const navigate = useCallback(
    (path: string) => {
      router.push(`/${locale}/${workspaceSlug}${path}`);
    },
    [router, locale, workspaceSlug]
  );

  const runQuickAction = useCallback(
    (id: QuickActionId) => {
      switch (id) {
        case "createAgent":
          navigate("/agents?new=1");
          break;
        case "createFlow":
          navigate("/flows?new=1");
          break;
        case "runMemoryHousekeeping":
          navigate("/settings/memory");
          break;
        case "openOnboarding":
          navigate("/onboarding");
          break;
        case "toggleTheme": {
          if (typeof document === "undefined") break;
          const root = document.documentElement;
          const isDark = root.classList.contains("dark");
          root.classList.toggle("dark", !isDark);
          try {
            window.localStorage.setItem("theme", isDark ? "light" : "dark");
          } catch {
            /* ignore */
          }
          break;
        }
        case "openBrain":
          navigate("/brain");
          break;
      }
    },
    [navigate]
  );

  const select = useCallback(
    (result: CommandResult) => {
      pushRecent({ key: resultKey(result), title: result.title, result });
      switch (result.kind) {
        case "resource": {
          const path =
            result.resource === "agent"
              ? `/agents/${result.id}`
              : result.resource === "flow"
                ? `/flows/${result.id}`
                : result.resource === "kb"
                  ? `/knowledge/${result.id}`
                  : `/conversations/${result.id}`;
          navigate(path);
          setOpen(false);
          break;
        }
        case "action":
          runQuickAction(result.actionId);
          setOpen(false);
          break;
        case "doc":
          // Stay in the bar; reveal long definition in the side panel.
          setActiveDoc(result.termKey);
          break;
        case "tour":
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("compass:tour", { detail: { tourId: result.tourId } })
            );
          }
          setOpen(false);
          break;
      }
    },
    [navigate, runQuickAction, setOpen]
  );

  // ── Reset transient state when the bar closes ──
  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveDoc(null);
    }
  }, [open]);

  if (!open) return null;

  const recentResults = recents.map((r) => r.result);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={() => setOpen(false)}
      role="presentation"
    >
      <div className="flex w-full max-w-2xl gap-3" onMouseDown={(e) => e.stopPropagation()}>
        <Command
          label={t("label")}
          aria-modal="true"
          role="dialog"
          className="flex-1 overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
        >
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Search className="h-4 w-4 text-muted" aria-hidden="true" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder={t("placeholder")}
              autoFocus
              role="combobox"
              aria-controls={listboxId}
              aria-expanded="true"
              className="flex-1 bg-transparent text-sm text-strong placeholder:text-faint outline-none"
            />
            <kbd className="rounded bg-elevated px-1.5 py-0.5 text-[10px] text-muted">esc</kbd>
          </div>

          <Command.List id={listboxId} className="max-h-[420px] overflow-y-auto py-1">
            <Command.Empty className="px-4 py-8 text-center text-xs text-muted">
              {t("empty")}
            </Command.Empty>

            {recentResults.length > 0 && query.length === 0 && (
              <Group heading={t("sections.recents")}>
                {recentResults.map((r) => (
                  <ResultRow
                    key={`recent-${resultKey(r)}`}
                    result={r}
                    locale={locale}
                    typeLabel={t(`type.${r.kind}`)}
                    onSelect={() => select(r)}
                  />
                ))}
              </Group>
            )}

            {results.actions.length > 0 && (
              <Group heading={t("sections.actions")}>
                {results.actions.map((r) => (
                  <ResultRow
                    key={resultKey(r)}
                    result={r}
                    locale={locale}
                    typeLabel={t("type.action")}
                    onSelect={() => select(r)}
                  />
                ))}
              </Group>
            )}

            {results.agents.length > 0 && (
              <Group heading={t("sections.agents")}>
                {results.agents.slice(0, SECTION_SOFT_CAP).map((r) => (
                  <ResultRow
                    key={resultKey(r)}
                    result={r}
                    locale={locale}
                    typeLabel={t("type.agent")}
                    onSelect={() => select(r)}
                  />
                ))}
                <OverflowNotice
                  shown={Math.min(results.agents.length, SECTION_SOFT_CAP)}
                  total={results.agents.length}
                  label={t("overflow", {
                    shown: Math.min(results.agents.length, SECTION_SOFT_CAP),
                    total: results.agents.length,
                  })}
                />
              </Group>
            )}

            {results.flows.length > 0 && (
              <Group heading={t("sections.flows")}>
                {results.flows.slice(0, SECTION_SOFT_CAP).map((r) => (
                  <ResultRow
                    key={resultKey(r)}
                    result={r}
                    locale={locale}
                    typeLabel={t("type.flow")}
                    onSelect={() => select(r)}
                  />
                ))}
                <OverflowNotice
                  shown={Math.min(results.flows.length, SECTION_SOFT_CAP)}
                  total={results.flows.length}
                  label={t("overflow", {
                    shown: Math.min(results.flows.length, SECTION_SOFT_CAP),
                    total: results.flows.length,
                  })}
                />
              </Group>
            )}

            {results.kbs.length > 0 && (
              <Group heading={t("sections.knowledge")}>
                {results.kbs.slice(0, SECTION_SOFT_CAP).map((r) => (
                  <ResultRow
                    key={resultKey(r)}
                    result={r}
                    locale={locale}
                    typeLabel={t("type.kb")}
                    onSelect={() => select(r)}
                  />
                ))}
                <OverflowNotice
                  shown={Math.min(results.kbs.length, SECTION_SOFT_CAP)}
                  total={results.kbs.length}
                  label={t("overflow", {
                    shown: Math.min(results.kbs.length, SECTION_SOFT_CAP),
                    total: results.kbs.length,
                  })}
                />
              </Group>
            )}

            {results.conversations.length > 0 && (
              <Group heading={t("sections.conversations")}>
                {results.conversations.slice(0, SECTION_SOFT_CAP).map((r) => (
                  <ResultRow
                    key={resultKey(r)}
                    result={r}
                    locale={locale}
                    typeLabel={t("type.conversation")}
                    onSelect={() => select(r)}
                  />
                ))}
                <OverflowNotice
                  shown={Math.min(results.conversations.length, SECTION_SOFT_CAP)}
                  total={results.conversations.length}
                  label={t("overflow", {
                    shown: Math.min(results.conversations.length, SECTION_SOFT_CAP),
                    total: results.conversations.length,
                  })}
                />
              </Group>
            )}

            <Group heading={t("sections.docs")}>
              {results.docs.map((r) => (
                <ResultRow
                  key={resultKey(r)}
                  result={r}
                  locale={locale}
                  typeLabel={t("type.doc")}
                  onSelect={() => select(r)}
                />
              ))}
            </Group>

            <Group heading={t("sections.tours")}>
              {results.tours.map((r) => (
                <ResultRow
                  key={resultKey(r)}
                  result={r}
                  locale={locale}
                  typeLabel={t("type.tour")}
                  onSelect={() => select(r)}
                />
              ))}
            </Group>
          </Command.List>

          <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[10px] text-faint">
            <span className="flex items-center gap-1.5">
              <History className="h-3 w-3" aria-hidden="true" />
              {t("footer")}
            </span>
            <span>{t("hint.navigate")}</span>
          </div>
        </Command>

        {activeDoc && (
          <DocPanel
            termKey={activeDoc}
            locale={locale}
            onClose={() => setActiveDoc(null)}
            closeLabel={t("doc.close")}
            learnMoreLabel={t("doc.learnMore")}
          />
        )}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────── Subcomponents

/**
 * Renders a "Showing N of M" line at the bottom of a section, ONLY when the
 * total exceeds the defensive soft cap. Silent in the common case. Not a
 * cmdk Item — it's purely informational and shouldn't be navigable.
 */
function OverflowNotice({ shown, total, label }: { shown: number; total: number; label: string }) {
  if (total <= shown) return null;
  return (
    <div role="note" className="px-3 pb-2 pt-1 text-[10px] uppercase tracking-wider text-faint">
      {label}
    </div>
  );
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="px-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted"
    >
      {children}
    </Command.Group>
  );
}

interface ResultRowProps {
  result: CommandResult;
  locale: CompassLocale;
  typeLabel: string;
  onSelect: () => void;
}

function ResultRow({ result, locale: _locale, typeLabel, onSelect }: ResultRowProps) {
  const Icon = iconFor(result);
  return (
    <Command.Item
      value={`${result.title} ${typeLabel} ${resultKey(result)}`}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-body aria-selected:bg-violet-500/15 aria-selected:text-violet-200"
    >
      <Icon className="h-4 w-4 text-muted" aria-hidden="true" />
      <span className="flex-1 truncate">{result.title}</span>
      {result.hint && (
        <span className="hidden truncate text-[11px] text-faint sm:inline sm:max-w-[200px]">
          {result.hint}
        </span>
      )}
      <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted">
        {typeLabel}
      </span>
    </Command.Item>
  );
}

interface DocPanelProps {
  termKey: CompassTermKey;
  locale: CompassLocale;
  onClose: () => void;
  closeLabel: string;
  learnMoreLabel: string;
}

function DocPanel({ termKey, locale, onClose, closeLabel, learnMoreLabel }: DocPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const short = getTermShort(termKey, locale);
  const long = getTermLong(termKey, locale);
  const href = COMPASS_TERMS[termKey]?.href;

  useEffect(() => {
    ref.current?.focus();
  }, [termKey]);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-label={termKey}
      className="hidden w-80 flex-shrink-0 overflow-hidden rounded-xl border border-line bg-surface shadow-2xl md:flex md:flex-col"
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="text-sm font-medium capitalize text-strong">{termKey}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="rounded p-1 text-muted hover:bg-elevated hover:text-strong"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm leading-relaxed text-body">
        <p>{short}</p>
        {long && <p className="text-muted">{long}</p>}
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-xs font-medium text-violet-400 hover:text-violet-300"
          >
            {learnMoreLabel} →
          </a>
        )}
      </div>
    </div>
  );
}
