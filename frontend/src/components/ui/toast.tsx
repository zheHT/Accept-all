"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/cn";

type Tone = "info" | "success" | "warning";

interface Toast {
  id: number;
  title: string;
  description?: string;
  tone: Tone;
}

const TONE_STYLE: Record<Tone, { icon: typeof Info; tile: string }> = {
  info: { icon: Info, tile: "bg-processing-50 text-processing-700 ring-processing-200" },
  success: { icon: CheckCircle2, tile: "bg-matched-50 text-matched-700 ring-matched-200" },
  warning: { icon: TriangleAlert, tile: "bg-review-50 text-review-700 ring-review-200" },
};

const ToastContext = createContext<(toast: Omit<Toast, "id">) => void>(() => {});

/** Confirms that an action actually happened — used by every non-navigating control. */
export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current.slice(-2), { ...toast, id }]);
      window.setTimeout(() => dismiss(id), 4500);
    },
    [dismiss],
  );

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-6 right-6 z-[2000] flex w-[360px] flex-col gap-2"
      >
        {toasts.map((toast) => {
          const style = TONE_STYLE[toast.tone];
          const Icon = style.icon;
          return (
            <div
              key={toast.id}
              className="glass-solid pointer-events-auto flex animate-[drawer-in_0.2s_ease-out] items-start gap-3 p-3.5"
            >
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset",
                  style.tile,
                )}
              >
                <Icon className="size-4" strokeWidth={2.25} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-ink-900">{toast.title}</span>
                {toast.description && (
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-500">
                    {toast.description}
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
                className="grid size-6 shrink-0 place-items-center rounded-md text-ink-400 transition-colors hover:bg-surface hover:text-ink-900"
              >
                <X className="size-3.5" strokeWidth={2.25} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
