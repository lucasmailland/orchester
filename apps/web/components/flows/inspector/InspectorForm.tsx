"use client";

import { useEffect, useMemo, useState } from "react";
import type { Node } from "@xyflow/react";
import { Trash2, ChevronDown, HelpCircle, Lightbulb } from "lucide-react";
import { useTranslations } from "next-intl";
import { getNodeDef, type Locale } from "@/lib/flows/node-registry";
import { getNodeDocs } from "@/lib/flows/node-docs";
import { SpreadsheetField } from "./SpreadsheetField";
import { ModelPicker } from "@/components/ai/ModelPicker";
import type { FieldDef } from "@/lib/flows/field-types";

/**
 * Inspector auto-generado desde el `node-registry`. Por cada campo del nodo
 * renderiza el control + label + ayuda + ejemplo. Los campos `advanced` van bajo
 * un acordeón "Avanzado". Muestra arriba "qué hace este nodo".
 */

interface Props {
  node: Node | null;
  locale: Locale;
  onChange: (n: Node) => void;
  onDelete: (id: string) => void;
  /** Datos disponibles para insertar en campos (variables del flujo + salidas). */
  availableData?: string[];
}

interface PickerOption {
  value: string;
  label: string;
}

export function InspectorForm({ node, locale, onChange, onDelete, availableData = [] }: Props) {
  const t = useTranslations("pages.flows.inspector");
  if (!node) {
    return (
      <div className="p-4 text-xs text-muted">
        {locale === "es"
          ? "Seleccioná un nodo para configurarlo, o pedile al copiloto que lo arme por vos."
          : locale === "pt-BR"
            ? "Selecione um nó para configurá-lo, ou peça ao copiloto para montá-lo."
            : "Pick a node to configure it, or ask the copilot to build it."}
      </div>
    );
  }

  const data = node.data as { label?: string; nodeId?: string; config?: Record<string, unknown> };
  const def = getNodeDef(String(data.nodeId ?? node.type ?? ""));
  const config = data.config ?? {};

  function update(patch: { label?: string; config?: Record<string, unknown> }) {
    onChange({
      ...node!,
      data: {
        ...data,
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        config: { ...config, ...(patch.config ?? {}) },
      },
    });
  }

  const title = def ? def.title[locale] : (node.type as string);
  const summary = def?.summary[locale];
  const docs = def ? getNodeDocs(def.id) : undefined;
  const fields = def?.fields ?? [];
  const basicFields = fields.filter((f) => !f.advanced);
  const advancedFields = fields.filter((f) => f.advanced);

  const visible = (f: FieldDef) =>
    !f.dependsOn || String(config[f.dependsOn.key] ?? "") === f.dependsOn.value;

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4 text-xs">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-strong">{title}</div>
          {summary && <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{summary}</p>}
        </div>
        <button
          type="button"
          onClick={() => onDelete(node.id)}
          aria-label={t("deleteNodeAria")}
          className="shrink-0 rounded-md p-1 text-muted hover:bg-hover hover:text-red-600 dark:hover:text-red-400"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Documentación del paso: qué hace, cuándo conviene, consejo */}
      {docs && (
        <details className="mb-3 rounded-lg border border-line bg-card">
          <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-[11px] font-medium text-violet-600 dark:text-violet-400">
            <HelpCircle className="h-3.5 w-3.5" /> How does this step work?
          </summary>
          <div className="space-y-2 px-3 pb-3 text-[11px] leading-relaxed text-muted">
            <p>{docs.whatFor[locale]}</p>
            <p>
              <span className="font-medium text-body">Cuándo conviene: </span>
              {docs.whenToUse[locale]}
            </p>
            {docs.tip && (
              <p className="flex items-start gap-1.5 rounded-md bg-amber-500/5 p-2 text-amber-700 dark:text-amber-300">
                <Lightbulb className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{docs.tip[locale]}</span>
              </p>
            )}
          </div>
        </details>
      )}

      {/* Nombre del paso (siempre editable) */}
      <FieldLabel label={t("nameLabel")} help={t("nameHelp")} />
      <input
        value={String(data.label ?? "")}
        onChange={(e) => update({ label: e.target.value })}
        className="mb-3 w-full rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-strong outline-none focus:border-violet-500/60"
      />

      <div className="space-y-3">
        {basicFields.filter(visible).map((f) => (
          <FieldRenderer
            key={f.key}
            field={f}
            value={config[f.key]}
            availableData={availableData}
            onChange={(v) => update({ config: { [f.key]: v } })}
          />
        ))}
      </div>

      {advancedFields.length > 0 && (
        <details className="mt-4 rounded-lg border border-line bg-card">
          <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-[11px] font-medium text-muted">
            <ChevronDown className="h-3 w-3" /> Advanced
          </summary>
          <div className="space-y-3 px-3 pb-3">
            {advancedFields.filter(visible).map((f) => (
              <FieldRenderer
                key={f.key}
                field={f}
                value={config[f.key]}
                availableData={availableData}
                onChange={(v) => update({ config: { [f.key]: v } })}
              />
            ))}
          </div>
        </details>
      )}

      {fields.length === 0 && (
        <p className="rounded-lg border border-line bg-card p-3 text-[11px] text-muted">
          Este paso no necesita configuración.
        </p>
      )}
    </div>
  );
}

function FieldLabel({
  label,
  help,
  example,
  required,
}: {
  label: string;
  help?: string | undefined;
  example?: string | undefined;
  required?: boolean | undefined;
}) {
  return (
    <div className="mb-1">
      <label className="text-[11px] font-medium text-body">
        {label}
        {required && <span className="text-red-600 dark:text-red-400"> *</span>}
      </label>
      {help && <p className="mt-0.5 text-[10px] leading-relaxed text-faint">{help}</p>}
      {example && (
        <p className="mt-0.5 text-[10px] text-faint">
          Ejemplo: <code className="font-mono">{example}</code>
        </p>
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-line bg-elevated px-2.5 py-1.5 text-strong placeholder:text-faint outline-none focus:border-violet-500/60";

/**
 * Selector visual de datos: en vez de obligar a escribir {{variable}}, muestra
 * los datos disponibles como chips. Al hacer click, inserta el dato por vos.
 */
function DataPicker({ data, onPick }: { data: string[]; onPick: (name: string) => void }) {
  if (data.length === 0) return null;
  return (
    <div className="mt-1.5">
      <p className="mb-1 text-[10px] text-faint">Insertá un dato (lo trae de pasos anteriores):</p>
      <div className="flex flex-wrap gap-1">
        {data.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => onPick(name)}
            className="rounded-full border border-line bg-card px-2 py-0.5 text-[10px] text-violet-600 dark:text-violet-400 hover:bg-violet-500/10"
            title={`Insertar ${name}`}
          >
            + {name}
          </button>
        ))}
      </div>
    </div>
  );
}

function FieldRenderer({
  field,
  value,
  onChange,
  availableData = [],
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  availableData?: string[];
}) {
  const t = useTranslations("pages.flows.inspector");
  const common = (
    <FieldLabel
      label={field.label}
      help={field.help}
      example={field.example}
      required={field.required}
    />
  );
  const showPicker = field.type === "variable" || field.type === "textarea";

  switch (field.type) {
    case "textarea":
    case "variable":
    case "code":
      return (
        <div>
          {common}
          <textarea
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            rows={field.type === "code" ? 5 : 3}
            className={`${inputCls} resize-y ${field.type === "code" ? "font-mono text-[11px]" : ""}`}
          />
          {showPicker && (
            <DataPicker
              data={availableData}
              onPick={(name) => onChange(`${String(value ?? "")}{{${name}}}`)}
            />
          )}
        </div>
      );
    case "number":
      return (
        <div>
          {common}
          <input
            type="number"
            value={value == null ? "" : Number(value)}
            onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
            placeholder={field.placeholder}
            className={inputCls}
          />
        </div>
      );
    case "boolean":
      return (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="accent-violet-500"
          />
          <span className="text-[11px] text-body">{field.label}</span>
        </label>
      );
    case "select":
      return (
        <div>
          {common}
          <select
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            className={inputCls}
          >
            <option value="">Choose an option…</option>
            {field.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      );
    case "cron":
      return (
        <div>
          {common}
          <select
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            className={inputCls}
          >
            <option value="">Choose a frequency…</option>
            <option value="*/15 * * * *">{t("cronEvery15")}</option>
            <option value="0 * * * *">{t("cronHourly")}</option>
            <option value="0 9 * * *">{t("cronDaily")}</option>
            <option value="0 9 * * 1">{t("cronWeekly")}</option>
            <option value="0 9 1 * *">{t("cronMonthly")}</option>
          </select>
        </div>
      );
    case "duration":
      return (
        <div>
          {common}
          <select
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            className={inputCls}
          >
            <option value="">Choose how long to wait…</option>
            <option value="30s">30 seconds</option>
            <option value="1m">1 minute</option>
            <option value="5m">5 minutes</option>
            <option value="1h">1 hour</option>
            <option value="1d">1 day</option>
          </select>
        </div>
      );
    case "json":
      return (
        <div>
          {common}
          <textarea
            value={typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 2)}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
            placeholder={field.placeholder ?? "{ }"}
            className={`${inputCls} resize-y font-mono text-[11px]`}
          />
        </div>
      );
    case "spreadsheet":
      return <SpreadsheetField value={value} onChange={onChange} label={common} />;
    case "model-picker":
      return (
        <div>
          {common}
          <ModelPicker
            capability={field.capability ?? "chat"}
            value={String(value ?? "")}
            onChange={onChange}
          />
        </div>
      );
    case "string-list":
      return <StringListField value={value} onChange={onChange} label={common} />;
    case "key-value":
      return <KeyValueField field={field} value={value} onChange={onChange} label={common} />;
    case "agent-picker":
      return (
        <RemotePicker
          field={field}
          value={value}
          onChange={onChange}
          label={common}
          url="/api/agents"
          mapTo={(d: { id: string; name: string }) => ({ value: d.id, label: d.name })}
        />
      );
    case "kb-picker":
      return (
        <RemotePicker
          field={field}
          value={value}
          onChange={onChange}
          label={common}
          url="/api/knowledge-bases"
          mapTo={(d: { id: string; name: string }) => ({ value: d.id, label: d.name })}
        />
      );
    case "channel-picker":
      return (
        <RemotePicker
          field={field}
          value={value}
          onChange={onChange}
          label={common}
          url="/api/channels"
          mapTo={(d: { id: string; name: string; type?: string }) => ({
            value: d.id,
            label: `${d.name}${d.type ? ` (${d.type})` : ""}`,
          })}
          allowEmpty
        />
      );
    case "integration-action":
      return (
        <IntegrationActionField
          field={field}
          value={value}
          config={{}}
          onChange={onChange}
          label={common}
        />
      );
    case "text":
    default:
      return (
        <div>
          {common}
          <input
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            className={inputCls}
          />
        </div>
      );
  }
}

function StringListField({
  value,
  onChange,
  label,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  label: React.ReactNode;
}) {
  const t = useTranslations("pages.flows.inspector");
  const list = Array.isArray(value) ? (value as string[]) : [];
  const setAt = (idx: number, v: string) => {
    const next = list.slice();
    next[idx] = v;
    onChange(next);
  };
  return (
    <div>
      {label}
      <div className="space-y-1.5">
        {list.map((v, idx) => (
          <div key={idx} className="flex gap-1.5">
            <input
              value={v}
              onChange={(e) => setAt(idx, e.target.value)}
              placeholder={t("pathValuePlaceholder")}
              className={`${inputCls} flex-1`}
            />
            <button
              type="button"
              onClick={() => onChange(list.filter((_, j) => j !== idx))}
              className="rounded-md px-2 text-muted hover:text-red-600 dark:hover:text-red-400"
              aria-label={t("removeAria")}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...list, ""])}
          className="text-[11px] text-violet-600 dark:text-violet-400 hover:underline"
        >
          + Agregar camino
        </button>
      </div>
    </div>
  );
}

function KeyValueField({
  value,
  onChange,
  label,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  label: React.ReactNode;
}) {
  const t = useTranslations("pages.flows.inspector");
  const obj = (value && typeof value === "object" ? value : {}) as Record<string, string>;
  const entries = Object.entries(obj);
  function setEntry(k: string, v: string, oldK?: string) {
    const next = { ...obj };
    if (oldK && oldK !== k) delete next[oldK];
    next[k] = v;
    onChange(next);
  }
  function remove(k: string) {
    const next = { ...obj };
    delete next[k];
    onChange(next);
  }
  return (
    <div>
      {label}
      <div className="space-y-1.5">
        {entries.map(([k, v]) => (
          <div key={k} className="flex gap-1.5">
            <input
              defaultValue={k}
              onBlur={(e) => setEntry(e.target.value, v, k)}
              placeholder={t("keyPlaceholder")}
              className={`${inputCls} flex-1`}
            />
            <input
              value={v}
              onChange={(e) => setEntry(k, e.target.value)}
              placeholder={t("valuePlaceholder")}
              className={`${inputCls} flex-1`}
            />
            <button
              type="button"
              onClick={() => remove(k)}
              className="rounded-md px-2 text-muted hover:text-red-600 dark:hover:text-red-400"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setEntry(`clave${entries.length + 1}`, "")}
          className="text-[11px] text-violet-600 dark:text-violet-400 hover:underline"
        >
          + Agregar
        </button>
      </div>
    </div>
  );
}

function RemotePicker<T extends { id: string }>({
  value,
  onChange,
  label,
  url,
  mapTo,
  allowEmpty,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  label: React.ReactNode;
  url: string;
  mapTo: (d: T) => PickerOption;
  allowEmpty?: boolean;
}) {
  const t = useTranslations("pages.flows.inspector");
  const [opts, setOpts] = useState<PickerOption[]>([]);
  useEffect(() => {
    let alive = true;
    fetch(url)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        const arr = Array.isArray(d) ? d : (d.rows ?? d.data ?? []);
        if (alive) setOpts(arr.map(mapTo));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // `mapTo` is stable per-render at the callsite (defined inline by the
    // caller's component). Including it would re-fetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return (
    <div>
      {label}
      <select
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
      >
        <option value="">{allowEmpty ? t("all") : t("pickOne")}</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function IntegrationActionField({
  value,
  onChange,
  label,
}: {
  field: FieldDef;
  value: unknown;
  config: Record<string, unknown>;
  onChange: (v: unknown) => void;
  label: React.ReactNode;
}) {
  const t = useTranslations("pages.flows.inspector");
  // value = "integrationId::action"
  const [integrations, setIntegrations] = useState<
    Array<{ id: string; type: string; name: string }>
  >([]);
  const [catalog, setCatalog] = useState<
    Array<{ id: string; actions: { key: string; description: string }[] }>
  >([]);
  useEffect(() => {
    fetch("/api/integrations")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setIntegrations(d.configured ?? []);
          setCatalog(d.catalog ?? []);
        }
      })
      .catch(() => {});
  }, []);
  const [intId, action] = String(value ?? "").split("::");
  const selected = integrations.find((x) => x.id === intId);
  const actions = useMemo(
    () => catalog.find((c) => c.id === selected?.type)?.actions ?? [],
    [catalog, selected]
  );
  return (
    <div className="space-y-2">
      {label}
      <select
        value={intId ?? ""}
        onChange={(e) => onChange(`${e.target.value}::`)}
        className={inputCls}
      >
        <option value="">Choose an integration…</option>
        {integrations.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name} ({x.type})
          </option>
        ))}
      </select>
      {selected && (
        <select
          value={action ?? ""}
          onChange={(e) => onChange(`${intId}::${e.target.value}`)}
          className={inputCls}
        >
          <option value="">Choose an action…</option>
          {actions.map((a) => (
            <option key={a.key} value={a.key} title={a.description}>
              {a.key}
            </option>
          ))}
        </select>
      )}
      {integrations.length === 0 && (
        <p className="text-[10px] text-faint">
          {t.rich("noIntegrations", {
            link: (chunks) => (
              <span className="text-violet-600 dark:text-violet-400">{chunks}</span>
            ),
          })}
        </p>
      )}
    </div>
  );
}
