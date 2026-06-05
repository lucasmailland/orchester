"use client";

import dynamic from "next/dynamic";
import { Spinner } from "@heroui/react";
import type { FullDashboardStats } from "@/lib/db-queries";

/**
 * Client-only dynamic wrapper for DashboardClient.
 *
 * DashboardClient renders a suite of recharts charts (ComposedChart, PieChart,
 * BarChart, AreaChart, ...). recharts is large and browser-only, so loading the
 * dashboard via next/dynamic with { ssr: false } keeps it out of the initial
 * route bundle and defers it until the dashboard is rendered (K3: code-splitting).
 *
 * The dashboard page is a Server Component, so the dynamic({ ssr: false }) call
 * lives here behind a "use client" boundary rather than in the page itself.
 */
type Props = {
  stats: FullDashboardStats;
  workspaceName: string;
  locale: string;
  workspaceSlug: string;
};

const DashboardClient = dynamic(() => import("./DashboardClient").then((m) => m.DashboardClient), {
  ssr: false,
  loading: () => (
    <div className="flex h-64 w-full items-center justify-center">
      <Spinner size="lg" />
    </div>
  ),
});

export function DashboardClientLazy(props: Props) {
  return <DashboardClient {...props} />;
}
