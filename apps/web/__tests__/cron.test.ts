import { describe, it, expect } from "vitest";
import { isValidCron, computeNextRun } from "@/lib/cron";

describe("isValidCron", () => {
  it("accepts real 5-field expressions", () => {
    expect(isValidCron("*/5 * * * *")).toBe(true);
    expect(isValidCron("0 9 * * 1")).toBe(true);
    expect(isValidCron("0 0 1 * *")).toBe(true);
  });

  it("rejects the garbage the old regex accepted", () => {
    expect(isValidCron("foo bar baz qux quux")).toBe(false);
    expect(isValidCron("99 99 99 99 99")).toBe(false);
    expect(isValidCron("* * * *")).toBe(false);
    expect(isValidCron("")).toBe(false);
  });
});

describe("computeNextRun", () => {
  it("returns a future Date after the given anchor", () => {
    const anchor = new Date("2026-06-26T08:59:00.000Z");
    const next = computeNextRun("0 9 * * *", "UTC", anchor);
    expect(next).toBeInstanceOf(Date);
    expect(next!.toISOString()).toBe("2026-06-26T09:00:00.000Z");
  });

  it("honors the timezone for the wall-clock field", () => {
    const anchor = new Date("2026-06-26T00:00:00.000Z");
    // 09:00 in America/Argentina/Buenos_Aires (UTC-3) = 12:00 UTC
    const next = computeNextRun("0 9 * * *", "America/Argentina/Buenos_Aires", anchor);
    expect(next!.toISOString()).toBe("2026-06-26T12:00:00.000Z");
  });

  it("returns null for an invalid expression", () => {
    expect(computeNextRun("nope", "UTC", new Date())).toBeNull();
  });
});

describe("schedule creation backfill (ORCH-2)", () => {
  it("computes a non-null nextRunAt for a valid cron at create time", () => {
    const created = new Date("2026-06-26T08:00:00.000Z");
    const nextRunAt = computeNextRun("0 9 * * *", "UTC", created);
    expect(nextRunAt).not.toBeNull();
    expect(nextRunAt!.getTime()).toBeGreaterThan(created.getTime());
  });
});
