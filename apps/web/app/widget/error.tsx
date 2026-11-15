"use client";

import { useEffect } from "react";
import { captureException } from "@/lib/observability";

export default function WidgetError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error, { tags: { boundary: "widget-error" } });
  }, [error]);

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        background: "#0a0a0a",
        color: "#e4e4e7",
        fontFamily: "system-ui, sans-serif",
        padding: 24,
        textAlign: "center",
      }}
    >
      <p style={{ fontSize: 14 }}>El chat no está disponible en este momento.</p>
      <button
        type="button"
        onClick={() => reset()}
        style={{
          padding: "8px 16px",
          borderRadius: 10,
          border: "none",
          background: "#8b5cf6",
          color: "white",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Reintentar
      </button>
    </div>
  );
}
