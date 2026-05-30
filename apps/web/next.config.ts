import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * `standalone` output produces a self-contained server.js + minimal
   * node_modules. Required by deploy/Dockerfile and ideal for Railway/Fly.io.
   * Vercel ignores this and builds with its own runtime.
   */
  output: "standalone",
  /** Hosting providers (Railway, Fly) need the workspace root for tracing. */
  outputFileTracingRoot: process.cwd().replace(/\/apps\/web$/, ""),

  /**
   * Native / Node-only packages that bundlers should NOT try to bundle.
   * Loaded via require() from node_modules at runtime instead.
   *
   * Honored by both Turbopack (the default dev bundler) and Webpack
   * (`next build` and `dev:webpack`). Kept intentionally minimal — every
   * entry is a package using static-conditional requires of Node built-ins
   * (pgpass → split2 → stream, pg-boss → node:crypto) that the bundler's
   * resolver can't follow. If you can lazy-import the module inside a
   * Node-runtime guard instead of adding here, please do.
   */
  serverExternalPackages: [
    "pg",
    "pg-boss",
    "pgpass",
    "postgres",
    "redis",
    // Sentry server SDK and its OpenTelemetry dependency chain use `require()`
    // in ways webpack cannot statically analyze (require-in-the-middle).
    // Mark the full chain as server externals so webpack resolves them from
    // node_modules at runtime instead of bundling, preventing the
    // "Critical dependency: require function cannot be statically extracted" crash.
    "@sentry/nextjs",
    "@sentry/node",
    "@opentelemetry/instrumentation",
    "require-in-the-middle",
    "import-in-the-middle",
  ],

  images: {
    formats: ["image/avif", "image/webp"],
  },

  experimental: {
    /** Tree-shake barrel-file imports — ~10x fewer modules in dev compile. */
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
      // Audit 2026-05-26: also tree-shake these barrels — they're imported
      // from many client components, so even small per-module savings add up.
      "swr",
      "@dagrejs/dagre",
      "tailwind-merge",
      "clsx",
    ],
    serverSourceMaps: false,
  },

  transpilePackages: [],

  /**
   * Security headers — defense-in-depth on top of the reverse proxy (Caddy).
   * Detailed rationale in `docs/ARCHITECTURE.md` § Security posture.
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
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

// next-intl v3.x sets `experimental.turbo` (deprecated Next.js 15.3+ API) for
// its Turbopack resolve alias. Migrate the value to the top-level `turbopack`
// key so Next.js stops emitting the deprecation warning. Remove this shim once
// next-intl is updated to use `turbopack` directly.
const resolvedConfig = withNextIntl(nextConfig);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const legacyTurbo = (resolvedConfig as any).experimental?.turbo;
if (legacyTurbo) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (resolvedConfig as any).turbopack = { ...(resolvedConfig as any).turbopack, ...legacyTurbo };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (resolvedConfig as any).experimental.turbo;
}
export default resolvedConfig;
