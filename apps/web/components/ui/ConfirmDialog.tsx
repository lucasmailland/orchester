"use client";

import { useState, useCallback, useRef, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle } from "lucide-react";

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

interface DialogState extends ConfirmOptions {
  open: boolean;
  resolve: (v: boolean) => void;
}

let externalConfirm: ((opts: ConfirmOptions) => Promise<boolean>) | null = null;

/** Imperatively open the confirm dialog from anywhere. */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  if (!externalConfirm) {
    // Fallback if mounted before provider hydrates
    return Promise.resolve(window.confirm(opts.title));
  }
  return externalConfirm(opts);
}

export function ConfirmDialogHost(): ReactNode {
  const [state, setState] = useState<DialogState | null>(null);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const open = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setState({ ...opts, open: true, resolve });
    });
  }, []);

  externalConfirm = open;

  const close = (result: boolean) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setState(null);
  };

  return (
    <AnimatePresence>
      {state?.open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => close(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-950 p-5 shadow-2xl"
          >
            <div className="mb-3 flex items-start gap-3">
              {state.destructive && (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500/15 text-red-400">
                  <AlertTriangle className="h-4 w-4" />
                </div>
              )}
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">{state.title}</h3>
                {state.description && (
                  <p className="mt-1 text-xs text-zinc-400">{state.description}</p>
                )}
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => close(false)}
                className="rounded-lg px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              >
                {state.cancelText ?? "Cancelar"}
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => close(true)}
                className={
                  state.destructive
                    ? "rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-400"
                    : "rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-400"
                }
              >
                {state.confirmText ?? "Confirmar"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
