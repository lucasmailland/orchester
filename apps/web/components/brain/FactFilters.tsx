"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Search, Filter } from "lucide-react";
import { Input, Select, SelectItem, Switch } from "@heroui/react";
import { cn } from "@/lib/utils";
import type {
  FactKind,
  FactScope,
  FactStatus,
  FactsFilters,
  SortBy,
} from "@/lib/hooks/use-brain-facts";

const KINDS: FactKind[] = [
  "preference",
  "trait",
  "event",
  "relationship",
  "skill",
  "concern",
  "other",
];

const SCOPES: FactScope[] = ["global", "conversation", "employee", "team"];
const STATUSES: FactStatus[] = ["active", "forgotten", "merged"];
const SORTS: SortBy[] = ["updated", "created", "relevance", "hits"];

export interface FactFiltersProps {
  value: FactsFilters;
  onChange: (next: FactsFilters) => void;
}

export function FactFilters({ value, onChange }: FactFiltersProps) {
  const t = useTranslations("brain");
  // HeroUI's `Select` is backed by React Aria, which calls `useId()` to
  // mint listbox / trigger / label IDs. Those IDs differ between SSR and
  // the first client render under Next 15 + Turbopack, producing a flood
  // of "A tree hydrated but some attributes of the server rendered HTML
  // didn't match" warnings (Scope / Status / Sort by triggers). Same
  // shape we already applied to the Conversations filters: render a
  // skeleton-equivalent placeholder until `mounted` flips, then mount
  // the Select tree only on the client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // `update` used to fire `onChange({...value, [key]: v})` unconditionally.
  // The HeroUI Select rebuilds its `selectedKeys` array literal on every
  // parent render (`value.scope ? [value.scope] : []`), and React Aria
  // sometimes re-fires `onSelectionChange` when that reference changes
  // even though the selected key is semantically the same. The handler
  // then called `update("scope", "")`, which created a new filters
  // object → new render → new array literal → new `onSelectionChange`
  // call → "Maximum update depth exceeded".
  //
  // Short-circuiting here breaks the loop: if the incoming value matches
  // what's already in state, we skip the parent setState entirely and
  // React never schedules another render.
  function update<K extends keyof FactsFilters>(key: K, v: FactsFilters[K]) {
    if (value[key] === v) return;
    onChange({ ...value, [key]: v });
  }

  // Memoize per-Select `selectedKeys` so the array identity is stable
  // across renders. HeroUI/React-Aria internals are sensitive to prop
  // identity for controlled components; reusing the same reference
  // avoids spurious `onSelectionChange` firings on simple re-renders.
  const scopeSel = useMemo(() => (value.scope ? [value.scope] : []), [value.scope]);
  const statusSel = useMemo(() => [value.status ?? "active"], [value.status]);
  const sortSel = useMemo(() => [value.sortBy ?? "updated"], [value.sortBy]);

  return (
    <div className="space-y-3 rounded-xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-3.5 w-3.5 shrink-0 text-faint" />

        {/* Kind chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => update("kind", "")}
            className={cn(
              "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
              !value.kind
                ? "bg-violet-600/20 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/30"
                : "text-muted hover:bg-hover hover:text-body"
            )}
          >
            {t("filters.kindAll")}
          </button>
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => update("kind", k)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider transition-colors",
                value.kind === k
                  ? "bg-violet-600/20 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/30"
                  : "text-muted hover:bg-hover hover:text-body"
              )}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-12">
        {/* Search */}
        <div className="md:col-span-5">
          <Input
            size="sm"
            value={value.q ?? ""}
            onValueChange={(v) => update("q", v)}
            placeholder={t("filters.search")}
            startContent={<Search className="h-3.5 w-3.5 text-muted" />}
            classNames={{ inputWrapper: "bg-elevated" }}
            aria-label={t("filters.search")}
          />
        </div>

        {/* Scope — mounted-gated to dodge React Aria SSR id mismatch */}
        <div className="md:col-span-2">
          {mounted ? (
            <Select
              size="sm"
              aria-label={t("filters.scope")}
              placeholder={t("filters.scope")}
              selectedKeys={scopeSel}
              onSelectionChange={(keys) => {
                const k = Array.from(keys)[0] as FactScope | undefined;
                update("scope", (k ?? "") as FactScope | "");
              }}
              classNames={{ trigger: "bg-elevated" }}
            >
              <>
                <SelectItem key="">{t("filters.scopeAll")}</SelectItem>
                {SCOPES.map((s) => (
                  <SelectItem key={s}>{t(`filters.scope_${s}` as const)}</SelectItem>
                ))}
              </>
            </Select>
          ) : (
            <div className="h-8 rounded-md bg-elevated" aria-hidden />
          )}
        </div>

        {/* Status */}
        <div className="md:col-span-2">
          {mounted ? (
            <Select
              size="sm"
              aria-label={t("filters.status")}
              placeholder={t("filters.status")}
              selectedKeys={statusSel}
              onSelectionChange={(keys) => {
                const k = Array.from(keys)[0] as FactStatus | undefined;
                update("status", k ?? "active");
              }}
              classNames={{ trigger: "bg-elevated" }}
            >
              {STATUSES.map((s) => (
                <SelectItem key={s}>{t(`filters.status_${s}` as const)}</SelectItem>
              ))}
            </Select>
          ) : (
            <div className="h-8 rounded-md bg-elevated" aria-hidden />
          )}
        </div>

        {/* Sort */}
        <div className="md:col-span-2">
          {mounted ? (
            <Select
              size="sm"
              aria-label={t("filters.sortBy")}
              placeholder={t("filters.sortBy")}
              selectedKeys={sortSel}
              onSelectionChange={(keys) => {
                const k = Array.from(keys)[0] as SortBy | undefined;
                update("sortBy", k ?? "updated");
              }}
              classNames={{ trigger: "bg-elevated" }}
            >
              {SORTS.map((s) => (
                <SelectItem key={s}>
                  {t(
                    s === "updated"
                      ? "filters.sortUpdated"
                      : s === "created"
                        ? "filters.sortCreated"
                        : s === "relevance"
                          ? "filters.sortRelevance"
                          : "filters.sortHits"
                  )}
                </SelectItem>
              ))}
            </Select>
          ) : (
            <div className="h-8 rounded-md bg-elevated" aria-hidden />
          )}
        </div>

        {/* Pinned toggle */}
        <div className="flex items-center justify-end md:col-span-1">
          <Switch
            size="sm"
            isSelected={!!value.pinned}
            onValueChange={(v) => update("pinned", v ? true : undefined)}
            aria-label={t("filters.pinnedOnly")}
          >
            <span className="ml-1 text-[11px] text-muted">{t("filters.pinnedOnly")}</span>
          </Switch>
        </div>
      </div>
    </div>
  );
}
