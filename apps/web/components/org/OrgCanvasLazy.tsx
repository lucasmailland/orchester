"use client";

import dynamic from "next/dynamic";
import { Spinner } from "@heroui/react";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";

/**
 * Client-only dynamic wrapper for OrgCanvas.
 *
 * OrgCanvas statically pulls in @xyflow/react (and its CSS), which is a
 * sizeable browser-only dep. Loading it via next/dynamic with
 * `{ ssr: false }` keeps it out of the initial route bundle and defers
 * it until the org graph is rendered (K3: code-splitting).
 *
 * The org page is a Server Component, so the dynamic({ ssr: false })
 * call lives here in a "use client" boundary rather than in the page
 * itself. Mirrors the pattern used by FlowBuilderLazy / DashboardClientLazy.
 */
const OrgCanvas = dynamic(() => import("./OrgCanvas").then((m) => m.OrgCanvas), {
  ssr: false,
  loading: () => (
    <div className="flex h-[60vh] w-full items-center justify-center">
      <Spinner size="lg" />
    </div>
  ),
});

export function OrgCanvasLazy() {
  return (
    <ErrorBoundary label="OrgCanvas">
      <OrgCanvas />
    </ErrorBoundary>
  );
}
