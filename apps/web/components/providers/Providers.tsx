"use client";

import { HeroUIProvider } from "@heroui/react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { PresentationModeProvider } from "./PresentationModeProvider";
import { ConfirmDialogHost } from "@/components/ui/ConfirmDialog";

export function Providers({
  children,
  nonce,
}: {
  children: React.ReactNode;
  nonce?: string | undefined;
}) {
  return (
    <HeroUIProvider>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        forcedTheme="dark"
        enableSystem={false}
        disableTransitionOnChange={false}
        {...(nonce ? { nonce } : {})}
      >
        <PresentationModeProvider>
          {children}
          <ConfirmDialogHost />
          <Toaster
            position="bottom-right"
            toastOptions={{
              classNames: {
                toast: "font-sans rounded-xl shadow-large",
                success: "border-l-4 border-fichap-success",
                error: "border-l-4 border-fichap-danger",
              },
            }}
            richColors
          />
        </PresentationModeProvider>
      </ThemeProvider>
    </HeroUIProvider>
  );
}
