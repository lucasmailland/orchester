"use client";

import dynamic from "next/dynamic";
import { Spinner } from "@heroui/react";
import type { FlowDTO } from "./FlowBuilder";

/**
 * Client-only dynamic wrapper for FlowBuilder.
 *
 * FlowBuilder (~47KB) statically pulls in @xyflow/react + @dagrejs/dagre,
 * which are heavy and browser-only. Loading it via next/dynamic with
 * { ssr: false } keeps those deps out of the initial server/route bundle and
 * defers them until the flow editor is actually rendered (K3: code-splitting).
 *
 * The flow detail page is a Server Component, so the dynamic({ ssr: false })
 * call lives here in a "use client" boundary rather than in the page itself.
 */
const FlowBuilder = dynamic(
  () => import("./FlowBuilder").then((m) => m.FlowBuilder),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[60vh] w-full items-center justify-center">
        <Spinner size="lg" />
      </div>
    ),
  }
);

export function FlowBuilderLazy({ flow }: { flow: FlowDTO }) {
  return <FlowBuilder flow={flow} />;
}
