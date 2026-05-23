"use client";

import { useEffect, useState } from "react";
import { Loader2, Shield, ShieldCheck, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("pages.settings.twoFactor");
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
    if (!password) return toast.error(t("passwordRequired"));
    setBusy(true);
    try {
      const { data, error } = await authClient.twoFactor.enable({ password });
      if (error) {
        toast.error(error.message ?? t("setupFailed"));
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
    if (code.length < 6) return toast.error(t("code6"));
    setBusy(true);
    try {
      const { error } = await authClient.twoFactor.verifyTotp({ code });
      if (error) {
        toast.error(error.message ?? t("codeInvalid"));
        return;
      }
      toast.success(t("enabled"));
      setState("backup");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!password) return toast.error(t("passwordDisableRequired"));
    setBusy(true);
    try {
      const { error } = await authClient.twoFactor.disable({ password });
      if (error) {
        toast.error(error.message ?? t("disableFailed"));
        return;
      }
      toast.success(t("disabled"));
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
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-200">
          <ShieldCheck className="h-4 w-4" />
          <span>{t("enabledBanner")}</span>
        </div>
        <div className="space-y-2">
          <label htmlFor="2fa-disable-pw" className="text-xs text-muted">
            {t("disableLabel")}
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
            {t("disableButton")}
          </button>
        </div>
      </div>
    );
  }

  if (state === "backup") {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-200">
          {t("backupCodesWarning")}
        </div>
        <div className="rounded-lg border border-line bg-surface p-3 font-mono text-xs">
          <pre className="whitespace-pre-wrap break-all">{backupCodes.join("\n")}</pre>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void copyBackupCodes()} className="btn-secondary">
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? t("copied") : t("copyAll")}
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
            {t("doneSaved")}
          </button>
        </div>
      </div>
    );
  }

  if (state === "setup") {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted">{t("setupDescription")}</p>
        {totpURI && (
          <div className="flex justify-center rounded-lg border border-line bg-white p-4">
            {/* QR via Google Charts API */}
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(totpURI)}`}
              alt={t("qrAlt")}
              width={200}
              height={200}
            />
          </div>
        )}
        <details className="text-[10px] text-muted">
          <summary className="cursor-pointer">{t("cantScan")}</summary>
          <p className="mt-1">{t("pasteUrl")}</p>
          <code className="mt-1 block break-all rounded bg-surface p-2 font-mono">{totpURI}</code>
        </details>
        <label htmlFor="2fa-code" className="text-xs text-muted">
          {t("codeLabel")}
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
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={() => void verifyAndActivate()}
            disabled={busy || code.length !== 6}
            className="btn-primary"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t("verifyAndActivate")}
          </button>
        </div>
      </div>
    );
  }

  // disabled
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Shield className="h-4 w-4" />
        <span>{t("disabledHint")}</span>
      </div>
      <label htmlFor="2fa-enable-pw" className="text-xs text-muted">
        {t("confirmWithPassword")}
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
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Shield className="h-3.5 w-3.5" />
        )}
        {t("enableButton")}
      </button>
    </div>
  );
}
