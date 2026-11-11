import { useRef, type ReactNode } from "react";
import { jumpToDate } from "../model/store";

/** Opens the browser's calendar and shows the first message of the picked day (like the date chip in Telegram). */
export default function JumpToDateButton({
  conversationId,
  className,
  label,
  children,
}: {
  conversationId: string;
  className?: string;
  label: string;
  children: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const today = new Date();
  const max = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <span className="jump-to-date">
      <button
        type="button"
        className={className}
        aria-label={label}
        title={label}
        onClick={() => {
          const input = inputRef.current;
          if (!input) return;
          if (typeof input.showPicker === "function") input.showPicker();
          else input.focus();
        }}
      >
        {children}
      </button>
      <input
        ref={inputRef}
        type="date"
        max={max}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          if (event.target.value) void jumpToDate(conversationId, event.target.value);
          event.target.value = "";
        }}
      />
    </span>
  );
}
