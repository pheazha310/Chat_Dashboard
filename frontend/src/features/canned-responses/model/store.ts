import { create } from "zustand";
import {
  createTemplateRequest,
  deactivateTemplateRequest,
  listTemplates,
  updateTemplateRequest,
  type BackendTemplate,
} from "@/shared/api/rest";
import { notify } from "@/shared/ui";

export type Template = BackendTemplate;

type TemplatesState = {
  templates: Template[];
  status: "idle" | "loading" | "ready" | "error";
};

export const useTemplatesStore = create<TemplatesState>(() => ({ templates: [], status: "idle" }));

const byTitle = (a: Template, b: Template) => a.title.localeCompare(b.title);
const failure = (error: unknown, fallback: string) => notify(error instanceof Error ? error.message : fallback);

/** The templates this agent may use. The server decides who sees which (personal ones are private). */
export async function loadTemplates() {
  useTemplatesStore.setState({ status: "loading" });
  try {
    useTemplatesStore.setState({ templates: (await listTemplates()).sort(byTitle), status: "ready" });
  } catch {
    useTemplatesStore.setState({ status: "error" });
  }
}

export async function createTemplate(input: { title: string; content: string; shortcut?: string; shared: boolean }) {
  try {
    const created = await createTemplateRequest({
      title: input.title.trim(),
      content: input.content.trim(),
      ...(input.shortcut?.trim() ? { shortcut: input.shortcut.trim() } : {}),
      scope: input.shared ? "SHARED" : "PERSONAL",
    });
    useTemplatesStore.setState((state) => ({ templates: [...state.templates, created].sort(byTitle) }));
    return true;
  } catch (error) {
    failure(error, "Could not save the template");
    return false;
  }
}

export async function updateTemplate(
  id: string,
  patch: { title?: string; content?: string; shortcut?: string | null },
) {
  try {
    const updated = await updateTemplateRequest(id, patch);
    useTemplatesStore.setState((state) => ({
      templates: state.templates.map((t) => (t.id === id ? updated : t)).sort(byTitle),
    }));
    return true;
  } catch (error) {
    failure(error, "Could not update the template");
    return false;
  }
}

/** Deactivates (the template is kept on the server) and removes it from the picker. */
export async function deactivateTemplate(id: string) {
  try {
    await deactivateTemplateRequest(id);
    useTemplatesStore.setState((state) => ({ templates: state.templates.filter((t) => t.id !== id) }));
  } catch (error) {
    failure(error, "Could not deactivate the template");
  }
}

/** Templates whose title, text or shortcut contain the search text. */
export function searchTemplates(templates: Template[], query: string): Template[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return templates;
  return templates.filter((t) =>
    [t.title, t.content, t.shortcut ?? ""].some((field) => field.toLowerCase().includes(needle)),
  );
}
