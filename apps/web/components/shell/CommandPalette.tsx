"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Command } from "cmdk";
import {
  Bot,
  Workflow,
  BookOpen,
  MessageSquare,
  Network,
  Layers,
  Users,
  Radio,
  Settings,
  Home,
  Search,
} from "lucide-react";

interface QuickItem {
  id: string;
  type: "agent" | "flow" | "kb" | "channel";
  label: string;
}

const NAV: Array<{ label: string; path: string; Icon: typeof Bot }> = [
  { label: "Inicio", path: "/", Icon: Home },
  { label: "Agentes", path: "/agents", Icon: Bot },
  { label: "Flujos", path: "/flows", Icon: Workflow },
  { label: "Conocimiento", path: "/knowledge", Icon: BookOpen },
  { label: "Conversaciones", path: "/conversations", Icon: MessageSquare },
  { label: "Equipos", path: "/teams", Icon: Layers },
  { label: "Organigrama", path: "/org", Icon: Network },
  { label: "Empleados", path: "/employees", Icon: Users },
  { label: "Canales", path: "/channels", Icon: Radio },
  { label: "Ajustes", path: "/settings", Icon: Settings },
];

export function CommandPalette() {
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "es";
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<QuickItem[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      fetch("/api/agents").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/flows").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/knowledge-bases").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/channels").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([agents, flows, kbs, channels]) => {
        const out: QuickItem[] = [];
        for (const a of agents) out.push({ id: a.id, type: "agent", label: a.name });
        for (const f of flows) out.push({ id: f.id, type: "flow", label: f.name });
        for (const k of kbs) out.push({ id: k.id, type: "kb", label: k.name });
        for (const c of channels) out.push({ id: c.id, type: "channel", label: c.name });
        setItems(out);
      })
      .catch(() => setItems([]));
  }, [open]);

  function go(path: string) {
    router.push(`/${locale}${path}`);
    setOpen(false);
    setQ("");
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-4 pt-[15vh] backdrop-blur-sm">
      <Command
        label="Command palette"
        className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Search className="h-4 w-4 text-muted" />
          <Command.Input
            value={q}
            onValueChange={setQ}
            placeholder="Buscar agente, flujo, KB, página…"
            className="flex-1 bg-transparent text-sm text-strong placeholder:text-faint outline-none"
            autoFocus
          />
          <kbd className="rounded bg-elevated px-1.5 py-0.5 text-[10px] text-muted">esc</kbd>
        </div>
        <Command.List className="max-h-[400px] overflow-y-auto py-1">
          <Command.Empty className="px-4 py-6 text-center text-xs text-muted">
            Sin resultados.
          </Command.Empty>

          <Command.Group heading="Navegación" className="px-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted">
            {NAV.map((n) => (
              <Command.Item
                key={n.path}
                onSelect={() => go(n.path)}
                className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-body aria-selected:bg-violet-500/15 aria-selected:text-violet-200"
              >
                <n.Icon className="h-4 w-4 text-muted" />
                {n.label}
              </Command.Item>
            ))}
          </Command.Group>

          {items.length > 0 && (
            <Command.Group heading="Recursos" className="px-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted">
              {items.map((it) => (
                <Command.Item
                  key={`${it.type}-${it.id}`}
                  onSelect={() =>
                    go(
                      it.type === "agent"
                        ? `/agents/${it.id}`
                        : it.type === "flow"
                        ? `/flows/${it.id}`
                        : it.type === "kb"
                        ? `/knowledge/${it.id}`
                        : `/channels`
                    )
                  }
                  className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-body aria-selected:bg-violet-500/15 aria-selected:text-violet-200"
                >
                  {it.type === "agent" && <Bot className="h-4 w-4 text-violet-400" />}
                  {it.type === "flow" && <Workflow className="h-4 w-4 text-amber-400" />}
                  {it.type === "kb" && <BookOpen className="h-4 w-4 text-emerald-400" />}
                  {it.type === "channel" && <Radio className="h-4 w-4 text-blue-400" />}
                  <span className="flex-1 truncate">{it.label}</span>
                  <span className="text-[10px] uppercase tracking-wider text-faint">
                    {it.type}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
        <div className="border-t border-line px-4 py-2 text-[10px] text-faint">
          ↑↓ navegar · ↵ abrir · ⌘K cerrar
        </div>
      </Command>
    </div>
  );
}
