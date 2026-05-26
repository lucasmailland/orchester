"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { useParams } from "next/navigation";
import { Brain, Search as SearchIcon, Trash2, Pin } from "lucide-react";
import { notify } from "@/lib/toast";
import { cn } from "@/lib/utils";

interface Fact {
  id: string;
  agentId: string | null;
  scope: "global" | "conversation" | "employee" | "team";
  scopeRef: string | null;
  kind: string;
  subject: string;
  statement: string;
  confidence: number;
  pinned: boolean;
  relevance: number;
  hitCount: number;
  lastRecalledAt: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const fetcher = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error("fetch failed");
  return r.json();
};

export function BrainPanel() {
  const params = useParams<{ workspaceSlug: string }>();
  const slug = params?.workspaceSlug;
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Fact[] | null>(null);
  const [searching, setSearching] = useState(false);

  const { data, error, mutate, isLoading } = useSWR<{ facts: Fact[] }>(
    slug ? `/api/workspaces/${slug}/brain/facts?limit=100` : null,
    fetcher
  );

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || !slug || searching) return;
    setSearching(true);
    try {
      const r = await fetch(`/api/workspaces/${slug}/brain/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: query.trim(), topK: 10 }),
      });
      if (!r.ok) throw new Error("search_failed");
      const j = (await r.json()) as { hits: Array<{ fact: Fact; score: number }> };
      setSearchResults(j.hits.map((h) => h.fact));
    } catch {
      notify.error("Search failed");
    } finally {
      setSearching(false);
    }
  }

  async function deleteFact(id: string) {
    if (!slug) return;
    if (!confirm("Forget this fact? It will be soft-deleted (recoverable for 30 days).")) return;
    const r = await fetch(`/api/workspaces/${slug}/brain/facts/${id}`, { method: "DELETE" });
    if (r.ok) {
      notify.success("Fact forgotten");
      setSearchResults((s) => s?.filter((f) => f.id !== id) ?? null);
      void mutate();
    } else {
      notify.error("Forget failed");
    }
  }

  async function togglePin(fact: Fact) {
    if (!slug) return;
    const r = await fetch(`/api/workspaces/${slug}/brain/facts/${fact.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned: !fact.pinned }),
    });
    if (r.ok) {
      void mutate();
      if (searchResults) {
        setSearchResults(
          (s) => s?.map((f) => (f.id === fact.id ? { ...f, pinned: !f.pinned } : f)) ?? null
        );
      }
    } else {
      notify.error("Pin failed");
    }
  }

  useEffect(() => {
    if (!query.trim()) setSearchResults(null);
  }, [query]);

  const shown = searchResults ?? data?.facts ?? [];

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-fichap-primary" />
            <h2 className="text-lg font-bold text-strong">Brain</h2>
          </div>
          <p className="mt-1 text-sm text-muted">
            Durable facts the workspace&apos;s agents have learned. Extracted automatically from
            conversations; you can pin, edit, or forget any of them.
          </p>
        </div>
        {data?.facts ? (
          <span className="rounded-full bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-400">
            {data.facts.length} {data.facts.length === 1 ? "fact" : "facts"}
          </span>
        ) : null}
      </header>

      <form onSubmit={runSearch} className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            placeholder="Search facts semantically — e.g. 'communication preferences'"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-lg border border-line bg-elevated py-2 pl-10 pr-3 text-sm text-strong outline-none focus:border-fichap-primary"
          />
        </div>
        <button
          type="submit"
          disabled={!query.trim() || searching}
          className="rounded-lg bg-fichap-primary px-4 py-2 text-sm font-medium text-white hover:bg-fichap-primary/90 disabled:opacity-50"
        >
          {searching ? "…" : "Search"}
        </button>
      </form>

      {isLoading && <div className="text-sm text-muted">Loading…</div>}
      {error && <div className="text-sm text-red-400">Failed to load facts. Refresh the page.</div>}

      {!isLoading && shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-card p-8 text-center text-sm text-muted">
          {searchResults ? (
            <>No facts match this query.</>
          ) : (
            <>
              No facts yet. Brain extracts facts after each conversation — start chatting with an
              agent and they&apos;ll appear here.
            </>
          )}
        </div>
      ) : null}

      <ul className="space-y-2">
        {shown.map((fact) => (
          <li
            key={fact.id}
            className={cn(
              "rounded-xl border bg-card p-4",
              fact.pinned ? "border-violet-500/30" : "border-line"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-faint">
                  <span className="rounded bg-elevated px-2 py-0.5">{fact.kind}</span>
                  <span className="rounded bg-elevated px-2 py-0.5">{fact.subject}</span>
                  <span className="text-faint">·</span>
                  <span>{fact.scope}</span>
                  <span className="text-faint">·</span>
                  <span>confidence {(fact.confidence * 100).toFixed(0)}%</span>
                  {fact.hitCount > 0 && (
                    <>
                      <span className="text-faint">·</span>
                      <span>{fact.hitCount} recalls</span>
                    </>
                  )}
                </div>
                <p className="mt-2 text-sm text-strong">{fact.statement}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => togglePin(fact)}
                  className={cn(
                    "rounded-md p-1.5 hover:bg-hover",
                    fact.pinned ? "text-violet-400" : "text-muted"
                  )}
                  aria-label={fact.pinned ? "Unpin" : "Pin"}
                  title={fact.pinned ? "Unpin" : "Pin"}
                >
                  <Pin className="h-3.5 w-3.5" fill={fact.pinned ? "currentColor" : "none"} />
                </button>
                <button
                  type="button"
                  onClick={() => deleteFact(fact.id)}
                  className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-red-400"
                  aria-label="Forget"
                  title="Forget"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
