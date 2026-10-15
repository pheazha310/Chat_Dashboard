import { create } from "zustand";
import { useEffect } from "react";

type ToastState = {
  message: string;
  show: (message: string) => void;
  clear: () => void;
};

export const useToastStore = create<ToastState>((set) => ({
  message: "",
  show: (message) => set({ message }),
  clear: () => set({ message: "" }),
}));

export const notify = (message: string) => useToastStore.getState().show(message);

export function Toaster() {
  const message = useToastStore((state) => state.message);
  const clear = useToastStore((state) => state.clear);

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(clear, 2400);
    return () => window.clearTimeout(timeout);
  }, [message, clear]);

  return message ? (
    <div className="prototype-toast" role="status">
      {message}
    </div>
  ) : null;
}
