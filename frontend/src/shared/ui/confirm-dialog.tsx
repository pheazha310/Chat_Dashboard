import { useState } from "react";
import { create } from "zustand";
import { Button } from "./button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog";

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as a destructive action (default true). */
  destructive?: boolean;
};

export type PromptOptions = Omit<ConfirmOptions, "destructive"> & {
  /** Visible label of the text field. */
  inputLabel: string;
  placeholder?: string;
  /** The confirm button stays disabled until something is typed. */
  required?: boolean;
  maxLength?: number;
  destructive?: boolean;
};

type InputSpec = { label: string; placeholder?: string; required?: boolean; maxLength?: number };

type ConfirmRequest = ConfirmOptions & {
  id: number;
  input?: InputSpec;
  resolve: (confirmed: boolean, value: string) => void;
};

type ConfirmState = {
  request: ConfirmRequest | null;
  open: (request: Omit<ConfirmRequest, "id">) => void;
  settle: (confirmed: boolean, value?: string) => void;
};

let nextId = 0;

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,
  open: (request) => {
    get().request?.resolve(false, "");
    set({ request: { ...request, id: ++nextId } });
  },
  settle: (confirmed, value = "") => {
    get().request?.resolve(confirmed, value);
    set({ request: null });
  },
}));

/** In-app replacement for `window.confirm`; resolves true when the user confirms. */
export const confirmAction = (options: ConfirmOptions): Promise<boolean> =>
  new Promise((resolve) => useConfirmStore.getState().open({ ...options, resolve: (confirmed) => resolve(confirmed) }));

/** In-app replacement for `window.prompt`; resolves the trimmed text, or null when cancelled. */
export const promptAction = ({
  inputLabel,
  placeholder,
  required,
  maxLength,
  destructive = false,
  ...options
}: PromptOptions): Promise<string | null> =>
  new Promise((resolve) =>
    useConfirmStore.getState().open({
      ...options,
      destructive,
      input: { label: inputLabel, placeholder, required, maxLength },
      resolve: (confirmed, value) => resolve(confirmed ? value.trim() : null),
    }),
  );

function ConfirmForm({ request }: { request: ConfirmRequest }) {
  const settle = useConfirmStore((state) => state.settle);
  const [value, setValue] = useState("");
  const { input } = request;
  const blocked = input?.required === true && value.trim() === "";
  const submit = () => !blocked && settle(true, value);

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{request.title}</DialogTitle>
        {request.description && <DialogDescription>{request.description}</DialogDescription>}
      </DialogHeader>
      {input && (
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">
            {input.label}
            {!input.required && <span className="font-normal text-muted-foreground"> (optional)</span>}
          </span>
          <textarea
            className="min-h-20 w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            value={value}
            placeholder={input.placeholder}
            maxLength={input.maxLength ?? 1000}
            autoFocus
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              // Enter alone adds a line; Ctrl/⌘ + Enter confirms, as in the notes composer.
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submit();
              }
            }}
          />
        </label>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => settle(false)}>
          {request.cancelLabel ?? "Cancel"}
        </Button>
        <Button
          type="submit"
          variant={request.destructive === false ? "default" : "destructive"}
          autoFocus={!input}
          disabled={blocked}
        >
          {request.confirmLabel ?? "Confirm"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ConfirmDialogHost() {
  const request = useConfirmStore((state) => state.request);
  const settle = useConfirmStore((state) => state.settle);

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && settle(false)}>
      {request && (
        <DialogContent showCloseButton={false}>
          {/* Keyed so each request starts with an empty field. */}
          <ConfirmForm key={request.id} request={request} />
        </DialogContent>
      )}
    </Dialog>
  );
}
