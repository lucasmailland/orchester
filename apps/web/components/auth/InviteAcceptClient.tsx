"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";

interface Props {
  token: string;
  invite: { email: string; role: string; status: string; workspaceName: string } | null;
}

export function InviteAcceptClient({ token, invite }: Props) {
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "es";
  const [accepting, setAccepting] = useState(false);

  if (!invite) {
    return (
      <div className="max-w-md rounded-2xl border border-red-500/30 bg-zinc-900/50 p-6 text-center">
        <h1 className="text-lg font-semibold text-red-300">Invitación no válida</h1>
        <p className="mt-1.5 text-sm text-zinc-400">
          El link expiró o nunca existió. Pedile a quien te invitó que genere una nueva.
        </p>
      </div>
    );
  }

  if (invite.status !== "pending") {
    return (
      <div className="max-w-md rounded-2xl border border-amber-500/30 bg-zinc-900/50 p-6 text-center">
        <h1 className="text-lg font-semibold text-amber-300">Invitación {invite.status}</h1>
        <p className="mt-1.5 text-sm text-zinc-400">Esta invitación ya no es válida.</p>
      </div>
    );
  }

  async function accept() {
    setAccepting(true);
    const r = await fetch("/api/invites/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    setAccepting(false);
    if (r.ok) {
      toast.success("Invitation accepted");
      router.push(`/${locale}`);
    } else {
      const j = await r.json();
      toast.error(j.error ?? "Couldn't accept");
    }
  }

  return (
    <div className="max-w-md rounded-2xl border border-violet-500/30 bg-zinc-900/50 p-6 text-center">
      <h1 className="text-lg font-semibold text-zinc-100">
        You were invited to {invite.workspaceName}
      </h1>
      <p className="mt-1.5 text-sm text-zinc-400">
        Role: <span className="font-mono text-violet-300">{invite.role}</span>
      </p>
      <button
        type="button"
        onClick={accept}
        disabled={accepting}
        className="mt-5 w-full rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-50"
      >
        {accepting ? "Accepting…" : "Accept invitation"}
      </button>
    </div>
  );
}
