import { create } from "zustand";
import { useEffect, useRef } from "react";
import { assets } from "@/shared/config";

export type ToastType = "info" | "success" | "warning" | "error";

type Toast = {
  id: number;
  message: string;
  type: ToastType;
};

type ToastState = {
  toasts: Toast[];
  show: (message: string, type?: ToastType) => void;
  dismiss: (id: number) => void;
};

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  show: (message, type = "info") =>
    set((state) => {
      const id = Date.now() + Math.random();
      const existing = state.toasts.find((toast) => toast.message === message);
      const filtered = existing ? state.toasts.filter((toast) => toast.id !== existing.id) : state.toasts;
      return { toasts: [...filtered, { id, message, type }] };
    }),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

export const notify = (message: string, type: ToastType = "info") => useToastStore.getState().show(message, type);

const TOAST_ICON: Record<ToastType, string> = {
  info: assets.icons.message,
  success: assets.icons.shield,
  warning: assets.icons.callback,
  error: assets.settings.userX,
};

function ToastTimer({ id }: { id: number }) {
  const dismiss = useToastStore((state) => state.dismiss);
  const timeoutRef = useRef<number | null>(null);
  useEffect(() => {
    timeoutRef.current = window.setTimeout(() => dismiss(id), 3200);
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, [id, dismiss]);
  return null;
}

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);

  return toasts.map((toast) => (
    <div key={toast.id} className={`prototype-toast toast-${toast.type}`} role="status">
      <ToastTimer id={toast.id} />
      <img className="toast-icon" src={TOAST_ICON[toast.type]} alt="" />
      <span className="toast-text">{toast.message}</span>
      <button
        type="button"
        className="toast-close"
        onClick={() => useToastStore.getState().dismiss(toast.id)}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  ));
}
