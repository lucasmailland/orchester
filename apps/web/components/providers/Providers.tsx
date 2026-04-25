"use client";

import { HeroUIProvider } from "@heroui/react";
import { ThemeProvider } from "next-themes";
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
        </PresentationModeProvider>
      </ThemeProvider>
    </HeroUIProvider>
  );
}
