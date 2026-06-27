import "server-only";
import parser from "cron-parser";

export function isValidCron(expr: string): boolean {
  const trimmed = expr.trim();
  if (trimmed.split(/\s+/).length !== 5) return false;
  try {
    parser.parseExpression(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function computeNextRun(
  expr: string,
  timezone: string,
  anchor: Date = new Date()
): Date | null {
  if (!isValidCron(expr)) return null;
  try {
    const it = parser.parseExpression(expr.trim(), {
      currentDate: anchor,
      tz: timezone || "UTC",
    });
    return it.next().toDate();
  } catch {
    return null;
  }
}
