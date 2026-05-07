"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import { User, Loader2 } from "lucide-react";
import { Field, FieldRow, SettingsCard } from "./_layout";

interface Props {
  me: {
    id: string;
    name: string;
    email: string;
    preferredLocale: string;
    preferredTheme: string;
  };
}

const LOCALES = [
  { value: "en", label: "🇺🇸 English" },
  { value: "es", label: "🇪🇸 Español" },
  { value: "pt-BR", label: "🇧🇷 Português (BR)" },
];

const THEMES = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Oscuro" },
  { value: "system", label: "Sistema" },
];

export function AccountSection({ me }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [name, setName] = useState(me.name);
  const [locale, setLocale] = useState(me.preferredLocale);
  const [theme, setTheme] = useState(me.preferredTheme);
  const [saving, setSaving] = useState(false);

  const dirty =
    name.trim() !== me.name ||
    locale !== me.preferredLocale ||
    theme !== me.preferredTheme;

  async function save() {
    if (!dirty) return;
    setSaving(true);
    const r = await fetch("/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        preferredLocale: locale,
        preferredTheme: theme,
      }),
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      toast.error(j.error ?? "No se pudo guardar");
      return;
    }
    toast.success("Cuenta actualizada");
    if (locale !== me.preferredLocale && pathname) {
      const newPath = pathname.replace(/^\/[a-zA-Z-]+/, `/${locale}`);
      router.push(newPath);
    } else {
      router.refresh();
    }
  }

  return (
    <SettingsCard
      icon={<User size={16} />}
      title="Mi cuenta"
      description="Datos personales y preferencias de la interfaz."
      action={
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="btn-primary"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Guardar
        </button>
      }
    >
      <FieldRow>
        <Field label="Nombre" htmlFor="me-name">
          <input
            id="me-name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tu nombre"
            maxLength={80}
            className="input"
          />
        </Field>
        <Field
          label="Email"
          htmlFor="me-email"
          hint="Para cambiar tu email, contactá soporte."
        >
          <input
            id="me-email"
            name="email"
            value={me.email}
            readOnly
            className="input cursor-not-allowed opacity-60"
          />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label="Idioma de la interfaz" htmlFor="me-locale">
          <select
            id="me-locale"
            name="locale"
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            className="input"
          >
            {LOCALES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tema" htmlFor="me-theme" hint="Aplicado al recargar.">
          <select
            id="me-theme"
            name="theme"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            className="input"
          >
            {THEMES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
      </FieldRow>

    </SettingsCard>
  );
}
