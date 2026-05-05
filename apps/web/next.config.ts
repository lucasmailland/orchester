import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
  /** Avoid double-running middleware/server components in dev */
  // reactStrictMode is on; that's a deliberate dev-only double render.
  // Keep it but at least the production build will be 1x.
  // For ULTRA-fast dev: turn off strict mode below if needed.
};

export default withNextIntl(nextConfig);
