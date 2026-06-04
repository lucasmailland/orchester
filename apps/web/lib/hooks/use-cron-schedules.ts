"use client";

/**
 * Tiny SWR wrapper for `/api/mnemo/cron-schedules`.
 *
 * The response is always one row per known job (the API materializes
 * defaults for jobs without a row) so consumers don't have to handle
 * a "missing row" case.
 */

import useSWR, { type SWRConfiguration } from "swr";
import type { CronSchedule } from "@/components/mnemo/CronScheduleEditor";

interface ScheduleListResponse {
  schedules: CronSchedule[];
}

async function fetcher(url: string): Promise<ScheduleListResponse> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Cron schedules fetch failed (${res.status})`);
  return (await res.json()) as ScheduleListResponse;
}

const SWR_DEFAULTS: SWRConfiguration = {
  revalidateOnFocus: false,
  dedupingInterval: 10_000,
};

export function useCronSchedules() {
  const { data, error, isLoading, mutate } = useSWR<ScheduleListResponse>(
    "/api/mnemo/cron-schedules",
    fetcher,
    SWR_DEFAULTS
  );

  return {
    schedules: data?.schedules ?? null,
    isLoading,
    error,
    mutate,
  };
}
