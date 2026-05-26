"use client";

import { useMemo } from "react";
import { Button } from "@heroui/react";
import { Clock, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * v1.6 G1-3: bitemporal "view memory as of …" picker for the Memory
 * Inspector.
 *
 * Selected value is a JS `Date` (UTC instant) or `null` for "now".
 * The parent owns the state — typically wired to the URL query
 * parameter `?asOf=ISO` so the historical view is shareable.
 *
 * Why a native <input type="date"> instead of HeroUI's `DatePicker`?
 * The HeroUI date input takes the `@internationalized/date` value
 * type and a `CalendarDate` (no time component) — fine for the day-
 * level granularity the audit row needs, but adding the package only
 * for one picker doubles the bundle. Native `<input type="date">` is
 * universally supported, accessible by default, respects locale,
 * and yields a YYYY-MM-DD string that we parse to a UTC midnight
 * instant on the way out.
 */
export interface TimeTravelPickerProps {
  /** Currently selected snapshot instant, or `null` for "now". */
  value: Date | null;
  /** Called with the new value — `null` means "now" (reset). */
  onChange: (next: Date | null) => void;
  /** Disable interaction (e.g. while a parent query is loading). */
  isDisabled?: boolean;
  className?: string;
}

function toInputValue(d: Date | null): string {
  if (!d) return "";
  // ISO date in UTC — `<input type="date">` expects YYYY-MM-DD.
  // Use the UTC parts so daylight savings / TZ offsets don't slide
  // the visible day around.
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromInputValue(raw: string): Date | null {
  if (!raw) return null;
  // Treat the user's chosen day as UTC midnight — the bitemporal
  // filter on the server checks `valid_from <= asOf`. Anchoring to
  // 23:59:59 UTC means we capture everything that existed up to and
  // including the chosen day, which matches the "view memory as of
  // <day>" mental model.
  const parsed = new Date(`${raw}T23:59:59.999Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function TimeTravelPicker({
  value,
  onChange,
  isDisabled,
  className,
}: TimeTravelPickerProps) {
  const t = useTranslations("brain.timeTravel");
  const todayIso = useMemo(() => toInputValue(new Date()), []);
  const inputValue = toInputValue(value);

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-1.5 ${className ?? ""}`}
      data-testid="time-travel-picker"
    >
      <Clock className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
      <label htmlFor="time-travel-date" className="text-[11px] text-muted">
        {t("label")}
      </label>
      <input
        id="time-travel-date"
        type="date"
        max={todayIso}
        value={inputValue}
        disabled={isDisabled}
        onChange={(e) => onChange(fromInputValue(e.target.value))}
        className="border-0 bg-transparent px-1 py-0 text-xs text-strong outline-none focus:ring-0"
        aria-label={t("label")}
      />
      {value ? (
        <Button
          size="sm"
          variant="light"
          onPress={() => onChange(null)}
          startContent={<RotateCcw className="h-3 w-3" />}
          className="h-6 min-w-0 px-2 text-[11px] text-muted"
          aria-label={t("reset")}
        >
          {t("now")}
        </Button>
      ) : null}
    </div>
  );
}
