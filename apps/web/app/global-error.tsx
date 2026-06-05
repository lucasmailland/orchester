"use client";

import { useEffect } from "react";

/**
 * Top-level fallback for errors thrown inside the root layout itself.
 * Next.js renders this OUTSIDE every layout (including [locale]), so it
 * must provide its own <html>/<body> and cannot rely on next-intl context.
 * Strings are hardcoded in Spanish (primary locale) by design.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <html lang="es" suppressHydrationWarning>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#000000",
          color: "#f4f4f5",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          padding: "1.5rem",
        }}
      >
        <div style={{ maxWidth: "28rem", textAlign: "center" }}>
          <p
            style={{
              fontSize: "0.6875rem",
              textTransform: "uppercase",
              letterSpacing: "0.18em",
              color: "#52525b",
              margin: "0 0 0.75rem",
            }}
          >
            Orchester
          </p>
          <h1
            style={{
              fontSize: "1.75rem",
              fontWeight: 700,
              lineHeight: 1.2,
              margin: "0 0 0.75rem",
            }}
          >
            Algo salió mal
          </h1>
          <p
            style={{
              fontSize: "0.875rem",
              color: "#a1a1aa",
              margin: "0 0 1.75rem",
            }}
          >
            Ocurrió un error inesperado. Vuelve a cargar la aplicación para continuar.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "0.75rem",
              border: "none",
              cursor: "pointer",
              padding: "0.75rem 1.25rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              color: "#ffffff",
              backgroundImage: "linear-gradient(to right, #7c3aed, #4f46e5)",
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
