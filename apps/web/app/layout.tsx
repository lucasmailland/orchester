import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Syne } from "next/font/google";
import { headers } from "next/headers";
import { Providers } from "@/components/providers/Providers";
import "./globals.css";

const syne = Syne({ subsets: ["latin"], variable: "--font-syne", display: "swap" });

export const metadata: Metadata = {
  title: {
    template: "%s | Orchester",
    default: "Orchester — AI Agent Platform",
  },
  description: "Build teams of AI agents for your enterprise in minutes.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // El middleware setea `x-nonce` por request. next-themes inyecta un script
  // inline anti-flash; sin nonce el CSP lo bloquea (error en consola). Se lo
  // pasamos para que quede dentro del allowlist del CSP.
  const h = await headers();
  const nonce: string | undefined = h.get("x-nonce") ?? undefined;
  // a11y-001: middleware forwards the URL-derived locale via `x-locale`
  // so the root layout can announce the right language to AT. Falls back
  // to "en" only for non-localized routes (which shouldn't exist with
  // `localePrefix: "always"`, but defending the cast).
  const locale = h.get("x-locale") ?? "en";

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} ${syne.variable} font-sans antialiased`}
      >
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
