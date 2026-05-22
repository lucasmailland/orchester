"use client";

import { useEffect, useState } from "react";
import { Mail, Plus, Loader2, Copy, Check, X, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Member {
  userId: string;
  role: "owner" | "admin" | "editor" | "viewer";
  joinedAt: string;
  name: string;
  email: string;
  image: string | null;
}

interface Invite {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

const ROLE_BADGE: Record<Member["role"], string> = {
  owner: "border-violet-500/40 bg-violet-500/10 text-violet-200",
  admin: "border-blue-500/40 bg-blue-500/10 text-blue-200",
  editor: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  viewer: "border-zinc-500/40 bg-zinc-500/10 text-body",
};

/**
 * Equipo: 2 paneles
 *  1. Miembros del workspace (con cambio de role + remove)
 *  2. Invitaciones pendientes (envío + lista)
 *
 * Todo conectado a `/api/workspace-members` y `/api/invites`.
 */
export function MembersSection() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [callerRole, setCallerRole] = useState<Member["role"] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);

  // Invite form
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "editor" | "viewer">("editor");
  const [submitting, setSubmitting] = useState(false);
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyMember, setBusyMember] = useState<string | null>(null);

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll() {
    const [mRes, iRes] = await Promise.all([
      fetch("/api/workspace-members"),
      fetch("/api/invites"),
    ]);
    if (mRes.ok) {
      const j = await mRes.json();
      setMembers(j.members);
      setCallerRole(j.callerRole);
    }
    if (iRes.ok) setInvites(await iRes.json());
  }

  async function sendInvite() {
    if (!email.trim()) return;
    setSubmitting(true);
    const r = await fetch("/api/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim(), role }),
    });
    setSubmitting(false);
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      toast.success("Invitación enviada");
      setEmail("");
      if (j.inviteUrl) setLastInviteUrl(j.inviteUrl);
      void loadAll();
    } else {
      toast.error(j.error ?? "Error");
    }
  }

  async function copyInviteUrl() {
    if (!lastInviteUrl) return;
    await navigator.clipboard.writeText(lastInviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function changeRole(m: Member, next: Member["role"]) {
    setBusyMember(m.userId);
    const r = await fetch(`/api/workspace-members?userId=${m.userId}&role=${next}`, {
      method: "PATCH",
    });
    setBusyMember(null);
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      toast.success("Rol actualizado");
      void loadAll();
    } else {
      toast.error(j.error ?? "No se pudo cambiar el rol");
    }
  }

  async function removeMember(m: Member) {
    if (!confirm(`¿Sacar a ${m.name} del workspace?`)) return;
    setBusyMember(m.userId);
    const r = await fetch(`/api/workspace-members?userId=${m.userId}`, { method: "DELETE" });
    setBusyMember(null);
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      toast.success("Miembro removido");
      void loadAll();
    } else {
      toast.error(j.error ?? "No se pudo remover");
    }
  }

  async function revokeInvite(id: string) {
    const r = await fetch(`/api/invites?id=${id}`, { method: "DELETE" });
    if (r.ok) {
      toast.success("Invitación revocada");
      void loadAll();
    } else {
      toast.error("No se pudo revocar");
    }
  }

  const canManage = callerRole === "owner" || callerRole === "admin";

  return (
    <div className="space-y-6">
      {/* Miembros activos */}
      <div className="rounded-2xl border border-line bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
            Miembros activos {members ? `· ${members.length}` : ""}
          </h3>
        </div>
        {members === null ? (
          <div className="flex items-center gap-2 text-xs text-muted">
            <Loader2 className="h-3 w-3 animate-spin" /> Cargando…
          </div>
        ) : members.length === 0 ? (
          <p className="text-xs text-muted">Sin miembros aún.</p>
        ) : (
          <ul className="space-y-1">
            {members.map((m) => (
              <li
                key={m.userId}
                className="flex items-center gap-3 rounded-lg border border-line bg-elevated px-3 py-2 text-xs"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-blue-600 text-[11px] font-bold text-white">
                  {m.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-strong">{m.name}</div>
                  <div className="truncate text-[10px] text-muted">{m.email}</div>
                </div>
                {canManage && m.role !== "owner" ? (
                  <RoleSelect
                    value={m.role}
                    disabled={busyMember === m.userId}
                    canPromoteOwner={callerRole === "owner"}
                    onChange={(next) => void changeRole(m, next)}
                  />
                ) : (
                  <span
                    className={cn(
                      "rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wider",
                      ROLE_BADGE[m.role]
                    )}
                  >
                    {m.role}
                  </span>
                )}
                {canManage && m.role !== "owner" && (
                  <button
                    type="button"
                    onClick={() => void removeMember(m)}
                    disabled={busyMember === m.userId}
                    aria-label={`Remover a ${m.name}`}
                    className="text-muted hover:text-red-400 disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Invitaciones */}
      <div className="rounded-2xl border border-line bg-card p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          Invitaciones {invites.length > 0 && `· ${invites.length}`}
        </h3>

        {lastInviteUrl && (
          <div className="mb-3 rounded-lg border border-violet-500/30 bg-violet-500/10 p-2.5 text-xs">
            <div className="mb-1 text-violet-200">Link de invitación (también enviado por email):</div>
            <div className="flex items-center gap-2 rounded bg-black/30 px-2 py-1.5">
              <code className="flex-1 break-all font-mono text-[10px] text-body">
                {lastInviteUrl}
              </code>
              <button
                onClick={copyInviteUrl}
                type="button"
                aria-label="Copiar link"
                className="text-muted hover:text-strong"
              >
                {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              </button>
            </div>
          </div>
        )}

        {invites.length > 0 && (
          <ul className="mb-3 space-y-1">
            {invites.map((i) => (
              <li
                key={i.id}
                className="flex items-center justify-between rounded-lg border border-line bg-elevated px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="truncate text-strong">{i.email}</div>
                  <div className="text-[10px] text-muted">
                    {i.role} · {i.status} · expira{" "}
                    {new Date(i.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void revokeInvite(i.id)}
                  aria-label={`Revocar invitación a ${i.email}`}
                  className="text-muted hover:text-red-400"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <label htmlFor="member-invite-email" className="sr-only">
              Email del invitado
            </label>
            <Mail className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
            <input
              id="member-invite-email"
              name="invite-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@empresa.com"
              className="flex-1 min-w-[200px] rounded-lg border border-line bg-elevated px-3 py-1.5 text-xs text-strong outline-none focus:border-violet-500/60"
            />
            <label htmlFor="member-invite-role" className="sr-only">
              Rol
            </label>
            <select
              id="member-invite-role"
              name="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as "admin" | "editor" | "viewer")}
              className="rounded-lg border border-line bg-elevated px-2 py-1.5 text-xs text-strong outline-none"
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="button"
              onClick={sendInvite}
              disabled={!email.trim() || submitting}
              className="btn-primary"
            >
              {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Invitar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function RoleSelect({
  value,
  onChange,
  disabled,
  canPromoteOwner,
}: {
  value: Member["role"];
  onChange: (next: Member["role"]) => void;
  disabled?: boolean;
  canPromoteOwner: boolean;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as Member["role"])}
        aria-label="Cambiar rol"
        className={cn(
          "appearance-none rounded-md border px-2 py-0.5 pr-5 text-[10px] uppercase tracking-wider",
          ROLE_BADGE[value],
          "disabled:opacity-50"
        )}
      >
        {canPromoteOwner && <option value="owner">owner</option>}
        <option value="admin">admin</option>
        <option value="editor">editor</option>
        <option value="viewer">viewer</option>
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-1 top-1/2 h-3 w-3 -translate-y-1/2 opacity-60"
        aria-hidden="true"
      />
    </div>
  );
}
