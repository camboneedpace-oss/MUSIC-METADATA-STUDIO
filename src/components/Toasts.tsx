import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, TriangleAlert, Undo2, X } from "lucide-react";
import { useStore } from "../lib/store";
import { cn } from "./ui/primitives";

const TONE: Record<string, { icon: React.ReactNode; cls: string; bar: string }> = {
  info: {
    icon: <Info size={13} />,
    cls: "text-[var(--info)]",
    bar: "bg-[var(--info)]",
  },
  success: {
    icon: <CheckCircle2 size={13} />,
    cls: "text-[var(--ok)]",
    bar: "bg-[var(--ok)]",
  },
  warning: {
    icon: <AlertTriangle size={13} />,
    cls: "text-[var(--warn)]",
    bar: "bg-[var(--warn)]",
  },
  error: {
    icon: <TriangleAlert size={13} />,
    cls: "text-[var(--danger)]",
    bar: "bg-[var(--danger)]",
  },
};

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  const undo = useStore((s) => s.undo);

  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed bottom-[36px] right-4 z-[70] flex w-[340px] flex-col gap-2">
      {toasts.map((toast) => {
        const tone = TONE[toast.kind] ?? TONE.info;
        return (
          <div
            key={toast.id}
            role="status"
            className="animate-toast-in surface pointer-events-auto relative flex items-start gap-2.5 overflow-hidden py-2.5 pl-3.5 pr-2"
          >
            {/* Tone rail — readable at a glance without relying on icon colour. */}
            <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", tone.bar)} />
            <span className={cn("mt-px shrink-0", tone.cls)}>{tone.icon}</span>

            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium leading-snug">{toast.message}</p>
              {toast.detail ? (
                <p className="mt-1 text-[11px] leading-snug text-[var(--text-dim)]">{toast.detail}</p>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-0.5">
              {toast.undoOperationId ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    undo();
                    dismiss(toast.id);
                  }}
                >
                  <Undo2 size={11} /> Undo
                </button>
              ) : null}
              <button
                type="button"
                aria-label="Dismiss notification"
                className="btn btn-sm btn-icon h-6 w-6"
                onClick={() => dismiss(toast.id)}
              >
                <X size={11} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}