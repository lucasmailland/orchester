"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft, FileText, Trash2, Plus, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface KB {
  id: string;
  name: string;
  description: string | null;
  embeddingProvider: string;
  embeddingModel: string;
}
interface Doc {
  id: string;
  title: string;
  source: string;
  status: string;
  chunkCount: number;
  error: string | null;
  createdAt: string;
}

const STATUS_COLOR: Record<string, string> = {
  pending: "text-muted",
  parsing: "text-blue-600 dark:text-blue-400",
  embedding: "text-amber-600 dark:text-amber-400",
  ready: "text-emerald-600 dark:text-emerald-400",
  failed: "text-red-600 dark:text-red-400",
};

export function KnowledgeDetailClient({ kb, docs }: { kb: KB; docs: Doc[] }) {
  const router = useRouter();
  const t = useTranslations("pages.knowledge.detail");
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "es";
  const [tab, setTab] = useState<"docs" | "search">("docs");
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState<"text" | "url" | "file">("text");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Search
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<
    Array<{ id: string; docTitle: string; text: string; score: number }>
  >([]);

  async function ingest() {
    if (!title.trim() && source !== "file") return toast.error(t("titleRequired"));
    if (source === "text" && !content.trim()) return toast.error(t("contentRequired"));
    if (source === "url" && !url.trim()) return toast.error(t("urlRequired"));
    if (source === "file" && !file) return toast.error(t("selectFile"));
    setSubmitting(true);

    let r: Response;
    if (source === "file" && file) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", title.trim() || file.name);
      fd.append("source", "file");
      r = await fetch(`/api/knowledge-bases/${kb.id}/docs`, {
        method: "POST",
        body: fd,
      });
    } else {
      r = await fetch(`/api/knowledge-bases/${kb.id}/docs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, source, content, url, contentType: "text/plain" }),
      });
    }
    setSubmitting(false);
    const j = await r.json();
    if (r.ok) {
      toast.success(t("indexed", { count: j.chunkCount }));
      setAdding(false);
      setTitle("");
      setContent("");
      setUrl("");
      router.refresh();
    } else {
      toast.error(j.error ?? t("indexError"));
    }
  }

  async function deleteDoc(id: string) {
    if (!confirm(t("confirmDelete"))) return;
    const r = await fetch(`/api/knowledge-bases/${kb.id}/docs/${id}`, { method: "DELETE" });
    if (r.ok) {
      toast.success(t("deleted"));
      router.refresh();
    }
  }

  async function search() {
    if (!q.trim()) return;
    setSearching(true);
    const r = await fetch(`/api/knowledge-bases/${kb.id}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: q, topK: 8 }),
    });
    setSearching(false);
    const j = await r.json();
    setResults(j.results ?? []);
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push(`/${locale}/knowledge`)}
          className="text-muted hover:text-strong"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-xl font-semibold text-strong">{kb.name}</h1>
          <p className="text-xs text-muted">
            {kb.description ?? "—"} ·{" "}
            <span className="font-mono">
              {kb.embeddingProvider}/{kb.embeddingModel}
            </span>
          </p>
        </div>
      </div>

      <div className="flex gap-1.5">
        {(["docs", "search"] as const).map((tabKey) => (
          <button
            key={tabKey}
            type="button"
            onClick={() => setTab(tabKey)}
            className={
              tab === tabKey
                ? "rounded-lg bg-elevated px-3 py-1.5 text-xs text-strong"
                : "rounded-lg px-3 py-1.5 text-xs text-muted hover:text-body"
            }
          >
            {tabKey === "docs" ? t("tabDocs") : t("tabSearch")}
          </button>
        ))}
      </div>

      {tab === "docs" && (
        <>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400"
            >
              <Plus className="h-3.5 w-3.5" /> {t("uploadDoc")}
            </button>
          </div>

          {adding && (
            <div className="space-y-2 rounded-xl border border-violet-500/30 bg-card p-4">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("titlePlaceholder")}
                className="w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-strong outline-none focus:border-violet-500/60"
                autoFocus
              />
              <div className="flex gap-2">
                {(["text", "url", "file"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSource(s)}
                    className={
                      source === s
                        ? "rounded-md bg-violet-500/20 px-2.5 py-1 text-xs text-violet-700 dark:text-violet-300"
                        : "rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:bg-hover"
                    }
                  >
                    {s === "text"
                      ? t("sourceText")
                      : s === "url"
                        ? t("sourceUrl")
                        : t("sourceFile")}
                  </button>
                ))}
              </div>
              {source === "text" && (
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={8}
                  placeholder={t("textPlaceholder")}
                  className="w-full resize-none rounded-lg border border-line bg-elevated px-3 py-2 font-mono text-xs text-strong outline-none focus:border-violet-500/60"
                />
              )}
              {source === "url" && (
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={t("urlPlaceholder")}
                  className="w-full rounded-lg border border-line bg-elevated px-3 py-2 font-mono text-xs text-strong outline-none focus:border-violet-500/60"
                />
              )}
              {source === "file" && (
                <div className="space-y-2">
                  <input
                    type="file"
                    accept=".pdf,.docx,.txt,.md,.json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,application/json,application/x-markdown"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setFile(f);
                      if (f && !title) setTitle(f.name);
                    }}
                    className="w-full rounded-lg border border-line bg-elevated px-3 py-2 text-xs text-strong file:mr-3 file:rounded-md file:border-0 file:bg-violet-500/20 file:px-2 file:py-1 file:text-violet-300"
                  />
                  {file && (
                    <p className="text-[10px] text-muted">
                      {file.name} · {(file.size / 1024).toFixed(1)} KB · {file.type || "?"}
                    </p>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={ingest}
                  disabled={submitting}
                  className="flex items-center gap-1 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-40"
                >
                  {submitting && <Loader2 className="h-3 w-3 animate-spin" />} {t("indexing")}
                </button>
                <button
                  type="button"
                  onClick={() => setAdding(false)}
                  className="text-xs text-muted hover:text-body"
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          )}

          {docs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line p-10 text-center">
              <FileText className="mx-auto mb-3 h-8 w-8 text-faint" />
              <h3 className="text-sm font-medium text-body">{t("emptyDocs")}</h3>
              <p className="mt-1 text-xs text-muted">{t("emptyDocsHint")}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {docs.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between rounded-xl border border-line bg-card px-4 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="h-4 w-4 text-muted" />
                    <div>
                      <div className="text-sm text-strong">{d.title}</div>
                      <div className="text-[10px] text-faint">
                        {d.source} · {d.chunkCount} chunks ·{" "}
                        <span className={STATUS_COLOR[d.status] ?? "text-muted"}>{d.status}</span>
                        {d.error && (
                          <span className="text-red-600 dark:text-red-400"> · {d.error}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteDoc(d.id)}
                    className="text-muted hover:text-red-600 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "search" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder={t("searchPlaceholder")}
              className="flex-1 rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-strong outline-none focus:border-violet-500/60"
            />
            <button
              type="button"
              onClick={search}
              disabled={searching || !q.trim()}
              className="flex items-center gap-1 rounded-lg bg-violet-500 px-3 py-2 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-40"
            >
              {searching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
              {t("search")}
            </button>
          </div>
          {results.length > 0 && (
            <div className="space-y-2">
              {results.map((r, i) => (
                <div key={r.id} className="rounded-xl border border-line bg-card p-3.5">
                  <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted">
                    <span>
                      #{i + 1} · {r.docTitle}
                    </span>
                    <span className="font-mono">score {r.score.toFixed(3)}</span>
                  </div>
                  <p className="text-xs text-body">{r.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
