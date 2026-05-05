"use client";

import { useEffect, useState } from "react";
import { Mail, Plus, Loader2, Copy, Check } from "lucide-react";
import { toast } from "sonner";

interface Invite {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

export function MembersSection() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "editor" | "viewer">("editor");
  const [submitting, setSubmitting] = useState(false);
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    const r = await fetch("/api/invites");
    if (r.ok) setInvites(await r.json());
  }
  useEffect(() => {
    load();
  }, []);

  async function send() {
    if (!email.trim()) return;
    setSubmitting(true);
    const r = await fetch("/api/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    setSubmitting(false);
    const j = await r.json();
    if (r.ok) {
      toast.success("Invitación enviada");
      setEmail("");
      if (j.inviteUrl) setLastInviteUrl(j.inviteUrl);
      load();
    } else toast.error(j.error ?? "Error");
  }

  async function copyUrl() {
    if (!lastInviteUrl) return;
    await navigator.clipboard.writeText(lastInviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-zinc-900/40 p-4">
      {lastInviteUrl && (
        <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 p-2.5 text-xs">
          <div className="mb-1 text-violet-200">Link de invitación (también enviado por email):</div>
          <div className="flex items-center gap-2 rounded bg-black/30 px-2 py-1.5">
            <code className="flex-1 break-all font-mono text-[10px] text-zinc-200">{lastInviteUrl}</code>
            <button onClick={copyUrl} type="button" className="text-zinc-400 hover:text-zinc-100">
              {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {invites.length === 0 && (
          <p className="text-xs text-zinc-500">Sin invitaciones aún.</p>
        )}
        {invites.map((i) => (
          <div
            key={i.id}
            className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-zinc-800/30 px-3 py-2 text-xs"
          >
            <div>
              <div className="text-zinc-100">{i.email}</div>
              <div className="text-[10px] text-zinc-500">
                {i.role} · {i.status} · expira {new Date(i.expiresAt).toLocaleDateString()}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-white/[0.06] pt-3">
        <Mail className="h-3.5 w-3.5 text-zinc-500" />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@empresa.com"
          type="email"
          className="flex-1 rounded-lg border border-white/[0.08] bg-zinc-800/40 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-violet-500/60"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "admin" | "editor" | "viewer")}
          className="rounded-lg border border-white/[0.08] bg-zinc-800/40 px-2 py-1.5 text-xs text-zinc-100 outline-none"
        >
          <option value="viewer">Viewer</option>
          <option value="editor">Editor</option>
          <option value="admin">Admin</option>
        </select>
        <button
          type="button"
          onClick={send}
          disabled={submitting || !email.trim()}
          className="flex items-center gap-1 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-40"
        >
          {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Invitar
        </button>
      </div>
    </div>
  );
}
