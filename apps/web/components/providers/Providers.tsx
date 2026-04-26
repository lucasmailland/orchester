"use client";

import { HeroUIProvider } from "@heroui/react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { PresentationModeProvider } from "./PresentationModeProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <HeroUIProvider>
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem
        disableTransitionOnChange={false}
      >
        <PresentationModeProvider>
          {children}
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
