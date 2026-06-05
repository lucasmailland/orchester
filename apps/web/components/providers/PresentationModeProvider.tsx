"use client";

import { createContext, useContext, useState } from "react";

interface PresentationModeContextValue {
  isPresenting: boolean;
  toggle: () => void;
  enable: () => void;
  disable: () => void;
}

const PresentationModeContext = createContext<PresentationModeContextValue | null>(null);

export function PresentationModeProvider({ children }: { children: React.ReactNode }) {
  const [isPresenting, setIsPresenting] = useState(false);

  const toggle = () => setIsPresenting((prev) => !prev);
  const enable = () => setIsPresenting(true);
  const disable = () => setIsPresenting(false);

  return (
    <PresentationModeContext.Provider value={{ isPresenting, toggle, enable, disable }}>
      {children}
    </PresentationModeContext.Provider>
  );
}

export function usePresentationMode(): PresentationModeContextValue {
  const ctx = useContext(PresentationModeContext);
  if (!ctx) {
    throw new Error("usePresentationMode must be used inside PresentationModeProvider");
  }
  return ctx;
}
