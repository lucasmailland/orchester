"use client";
import useSWR from "swr";

export interface MyWorkspace {
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended" | "deleted";
  timezone: string;
  role: "owner" | "admin" | "editor" | "viewer";
}

async function fetcher(url: string): Promise<{ workspaces: MyWorkspace[] }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error("fetch failed");
  return (await r.json()) as { workspaces: MyWorkspace[] };
}

/**
 * SWR-backed hook for the list of workspaces the current user belongs
 * to. Used by the switcher in the sidebar and by `/workspaces`.
 *
 * Revalidates on tab focus so two tabs converge after one mutates the
 * list (create / delete). 60s deduping keeps the network quiet while
 * the user is just clicking around.
 */
export function useMyWorkspaces() {
  const { data, error, isLoading, mutate } = useSWR<{
    workspaces: MyWorkspace[];
  }>("/api/me/workspaces", fetcher, {
    revalidateOnFocus: true,
    dedupingInterval: 60_000,
  });

  return {
    workspaces: data?.workspaces ?? [],
    isLoading,
    error,
    refresh: mutate,
  };
}
