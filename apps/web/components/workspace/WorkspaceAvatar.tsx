import { cn } from "@/lib/utils";

/**
 * Take the first letter of the first two words. Hyphenated or
 * single-word names collapse to a single initial. Falls back to "?"
 * on empty input so the avatar never renders blank.
 */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
}

/**
 * Small rounded badge used everywhere we display a workspace —
 * switcher row, list page, audit-log actor cell. `color` is the
 * workspace's accent hex (Phase E will let users set it; until then
 * we default to violet).
 */
export function WorkspaceAvatar({
  name,
  color,
  size = "md",
}: {
  name: string;
  color?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const dim =
    size === "sm"
      ? "h-6 w-6 text-[10px]"
      : size === "lg"
        ? "h-9 w-9 text-sm"
        : "h-7 w-7 text-[11px]";
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg font-bold text-white",
        dim
      )}
      style={{ backgroundColor: color ?? "#7C3AED" }}
    >
      {initials(name)}
    </div>
  );
}
