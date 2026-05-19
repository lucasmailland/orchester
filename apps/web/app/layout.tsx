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

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // El middleware setea `x-nonce` por request. next-themes inyecta un script
  // inline anti-flash; sin nonce el CSP lo bloquea (error en consola). Se lo
  // pasamos para que quede dentro del allowlist del CSP.
  const nonce: string | undefined = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} ${syne.variable} font-sans antialiased`}
      >
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
