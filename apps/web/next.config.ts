import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * `standalone` output produces a self-contained server.js + minimal
   * node_modules. Required by the Dockerfile in repo root and ideal for
   * Railway/Fly.io/AWS. Vercel ignores this and builds with its own runtime.
   */
  output: "standalone",
  /** Hosting providers (Railway, Fly) need the workspace root for tracing. */
  outputFileTracingRoot: process.cwd().replace(/\/apps\/web$/, ""),
  images: {
    formats: ["image/avif", "image/webp"],
  },
  experimental: {
    /**
     * Tree-shakes barrel-file imports so dev compile loads ~10x fewer modules.
     * Each entry replaces `import { Foo } from "x"` with the deep path
     * `import { Foo } from "x/Foo"` at compile time.
     */
    optimizePackageImports: [
      "@heroui/react",
      "@heroui/theme",
      "lucide-react",
      "recharts",
      "framer-motion",
      "@xyflow/react",
      "date-fns",
      "lodash",
      "react-hook-form",
      "@hookform/resolvers",
      "sonner",
      "cmdk",
    ],
    /** Faster Server Components in dev */
    serverSourceMaps: false,
  },
  /** Skip transpiling these — they're already ESM-friendly */
  transpilePackages: [],

  /**
   * Security headers aplicados a TODA respuesta. Defense-in-depth: incluso si
   * el reverse proxy (Caddy) ya los pone, los repetimos acá por si alguien
   * sirve Next.js directo. Headers idénticos no causan conflicto.
   *
   * Ver `docs/ARCHITECTURE.md` (sección "Security posture") para la justificación de cada header.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // HSTS sólo se aplica sobre HTTPS; los browsers lo ignoran en HTTP local.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // CSP dinámico con nonce se aplica en `middleware.ts`. Acá NO ponemos
          // CSP estático para que el dinámico no se duplique con headers
          // contradictorios. Si servís endpoints sin pasar por middleware
          // (e.g. /api/*), no hay HTML a proteger con CSP.
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
