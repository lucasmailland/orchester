"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { motion } from "framer-motion";
import { BookOpen, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { NoProviderBanner } from "@/components/common/NoProviderBanner";

interface KB {
  id: string;
  name: string;
  description: string | null;
  embeddingProvider: string;
  embeddingModel: string;
  createdAt: string;
}

export function KnowledgeListClient({ kbs }: { kbs: KB[] }) {
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "es";
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [provider, setProvider] = useState<"openai" | "google">("openai");

  async function create() {
    if (!name.trim()) return;
    const r = await fetch("/api/knowledge-bases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        description,
        embeddingProvider: provider,
        embeddingModel: provider === "openai" ? "text-embedding-3-small" : "text-embedding-004",
      }),
    });
    if (r.ok) {
      const j = await r.json();
      toast.success("Base de conocimiento creada");
      router.push(`/${locale}/knowledge/${j.id}`);
    } else {
      toast.error("No se pudo crear");
    }
  }

  return (
    <div className="space-y-6 p-6">
      <NoProviderBanner />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-strong">Conocimiento</h1>
          <p className="text-sm text-muted">
            Subí documentos para que tus agentes puedan responder con tu información (RAG).
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-lg bg-violet-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-violet-400"
        >
          <Plus className="h-4 w-4" /> Nueva base
        </button>
      </div>

      {creating && (
        <div className="space-y-2 rounded-2xl border border-violet-500/30 bg-card p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre — ej. Documentación interna"
            className="w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-strong outline-none focus:border-violet-500/60"
            autoFocus
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descripción (opcional)"
            className="w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm text-strong outline-none focus:border-violet-500/60"
          />
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted">Embeddings:</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as "openai" | "google")}
              className="rounded-lg border border-line bg-elevated px-2 py-1.5 text-xs text-strong outline-none"
            >
              <option value="openai">OpenAI · text-embedding-3-small (1536d)</option>
              <option value="google">Google · text-embedding-004 (768d)</option>
            </select>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={create}
              className="rounded-lg bg-violet-500 px-3 py-1.5 text-xs text-white hover:bg-violet-400"
            >
              Crear
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="text-xs text-muted hover:text-body"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {kbs.length === 0 && !creating && (
        <div className="rounded-2xl border border-dashed border-line p-10 text-center">
          <BookOpen className="mx-auto mb-3 h-8 w-8 text-faint" />
          <h3 className="text-sm font-medium text-body">Aún no hay bases de conocimiento</h3>
          <p className="mt-1 text-xs text-muted">
            Creá la primera y subí documentos para alimentar a tus agentes.
          </p>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {kbs.map((kb) => (
          <motion.button
            key={kb.id}
            type="button"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => router.push(`/${locale}/knowledge/${kb.id}`)}
            className="rounded-2xl border border-line bg-card p-4 text-left hover:border-violet-500/40"
          >
            <div className="mb-2 flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              <span className="font-medium text-strong">{kb.name}</span>
            </div>
            <p className="line-clamp-2 text-xs text-muted">{kb.description ?? "—"}</p>
            <div className="mt-3 flex items-center gap-1.5 text-[10px] text-faint">
              <Sparkles className="h-3 w-3" />
              <span className="font-mono">{kb.embeddingProvider}/{kb.embeddingModel}</span>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
