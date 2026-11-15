"use client";

import { Component, type ReactNode } from "react";
import { captureException } from "@/lib/observability";

interface Props {
  children: ReactNode;
  /** Rendered when a child throws. Defaults to a minimal inline message. */
  fallback?: ReactNode;
  /** Optional tag forwarded to Sentry for grouping (e.g. "OrgCanvas"). */
  label?: string;
}
interface State {
  hasError: boolean;
}

/**
 * PERF-12: reusable client error boundary. Catches render-time crashes in
 * heavy widgets so one broken sub-tree doesn't white-screen the page, and
 * reports the error to Sentry via the canonical `captureException` reporter
 * (lib/observability.ts — forwards to @sentry/nextjs when SENTRY_DSN is set).
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown): void {
    if (this.props.label) {
      captureException(error, { tags: { boundary: this.props.label } });
    } else {
      captureException(error);
    }
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center text-sm text-muted">
            Algo salió mal al renderizar esta sección.
          </div>
        )
      );
    }
    return this.props.children;
  }
}
