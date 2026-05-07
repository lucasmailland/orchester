"use client";

import { useEffect, useState } from "react";
import { Loader2, Shield, ShieldCheck, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";

/**
 * 2FA TOTP setup. 4 estados:
 *   1. disabled         → botón "Activar 2FA"
 *   2. setup            → muestra QR + input para verificar
 *   3. backupCodes      → muestra 10 códigos one-shot, fuerza al user a copiarlos
 *   4. enabled          → botón "Desactivar 2FA"
 *
 * Importante: better-auth requiere password antes de enable/disable, así que
 * tenemos un campo password también.
 */
export function TwoFactorSection({ enabled }: { enabled: boolean }) {
  const [state, setState] = useState<"disabled" | "setup" | "backup" | "enabled">(
    enabled ? "enabled" : "disabled"
  );
  const [password, setPassword] = useState("");
  const [totpURI, setTotpURI] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setState(enabled ? "enabled" : "disabled");
  }, [enabled]);

  async function startSetup() {
    if (!password) return toast.error("Ingresá tu password para confirmar");
    setBusy(true);
    try {
      const { data, error } = await authClient.twoFactor.enable({ password });
      if (error) {
        toast.error(error.message ?? "No se pudo iniciar setup");
        return;
      }
      setTotpURI(data.totpURI);
      setBackupCodes(data.backupCodes ?? []);
      setState("setup");
    } finally {
      setBusy(false);
    }
  }

  async function verifyAndActivate() {
    if (code.length < 6) return toast.error("Código de 6 dígitos");
    setBusy(true);
    try {
      const { error } = await authClient.twoFactor.verifyTotp({ code });
      if (error) {
        toast.error(error.message ?? "Código inválido");
        return;
      }
      toast.success("2FA activado");
      setState("backup");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!password) return toast.error("Ingresá tu password para desactivar");
    setBusy(true);
    try {
      const { error } = await authClient.twoFactor.disable({ password });
      if (error) {
        toast.error(error.message ?? "No se pudo desactivar");
        return;
      }
      toast.success("2FA desactivado");
      setState("disabled");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  async function copyBackupCodes() {
    await navigator.clipboard.writeText(backupCodes.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (state === "enabled") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
          <ShieldCheck className="h-4 w-4" />
          <span>2FA activado. Tu cuenta está protegida con autenticación de dos factores.</span>
        </div>
        <div className="space-y-2">
          <label htmlFor="2fa-disable-pw" className="text-xs text-zinc-400">
            Para desactivar, ingresá tu password:
          </label>
          <input
            id="2fa-disable-pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
            autoComplete="current-password"
          />
          <button
            type="button"
            onClick={() => void disable()}
            disabled={busy || !password}
            className="btn-danger"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Desactivar 2FA
          </button>
        </div>
      </div>
    );
  }

  if (state === "backup") {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          <strong>Guardá estos códigos en un lugar seguro.</strong> Sirven para
          loguearte si perdés acceso a tu app de autenticador. Cada código se
          puede usar UNA SOLA VEZ.
        </div>
        <div className="rounded-lg border border-white/10 bg-zinc-900 p-3 font-mono text-xs">
          <pre className="whitespace-pre-wrap break-all">{backupCodes.join("\n")}</pre>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void copyBackupCodes()}
            className="btn-secondary"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copiado" : "Copiar todos"}
          </button>
          <button
            type="button"
            onClick={() => {
              setState("enabled");
              setBackupCodes([]);
              setPassword("");
            }}
            className="btn-primary"
          >
            Listo, los guardé
          </button>
        </div>
      </div>
    );
  }

  if (state === "setup") {
    return (
      <div className="space-y-3">
        <p className="text-xs text-zinc-400">
          Escaneá el QR con tu app de autenticador (Google Authenticator, Authy,
          1Password, etc.) y luego ingresá el código de 6 dígitos.
        </p>
        {totpURI && (
          <div className="flex justify-center rounded-lg border border-white/10 bg-white p-4">
            {/* QR como image vía Google Charts API (funciona offline también si pegás otro QR generator) */}
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(totpURI)}`}
              alt="QR del TOTP secret"
              width={200}
              height={200}
            />
          </div>
        )}
        <details className="text-[10px] text-zinc-500">
          <summary className="cursor-pointer">¿No podés escanear?</summary>
          <p className="mt-1">Pegá esta URL en tu app:</p>
          <code className="mt-1 block break-all rounded bg-zinc-900 p-2 font-mono">
            {totpURI}
          </code>
        </details>
        <label htmlFor="2fa-code" className="text-xs text-zinc-400">
          Código de 6 dígitos
        </label>
        <input
          id="2fa-code"
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="input font-mono text-center text-lg tracking-widest"
          autoComplete="one-time-code"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setState("disabled");
              setTotpURI(null);
              setCode("");
            }}
            className="btn-secondary"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void verifyAndActivate()}
            disabled={busy || code.length !== 6}
            className="btn-primary"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Verificar y activar
          </button>
        </div>
      </div>
    );
  }

  // disabled
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <Shield className="h-4 w-4" />
        <span>2FA no está activado. Recomendado para cuentas owner/admin.</span>
      </div>
      <label htmlFor="2fa-enable-pw" className="text-xs text-zinc-400">
        Confirmá con tu password:
      </label>
      <input
        id="2fa-enable-pw"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="input"
        autoComplete="current-password"
      />
      <button
        type="button"
        onClick={() => void startSetup()}
        disabled={busy || !password}
        className="btn-primary"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
        Activar 2FA
      </button>
    </div>
  );
}
