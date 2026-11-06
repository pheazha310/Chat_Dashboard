import { apiRequest } from "./client";

export type BackendTemplate = {
  id: string;
  title: string;
  content: string;
  shortcut: string | null;
  scope: "PERSONAL" | "SHARED" | "TEAM";
  createdBy: string;
  isActive: boolean;
  permissions: { canEdit: boolean };
};

/** Saved reply templates (docs/api-canned-responses.md). */
export const listTemplates = async (query: { q?: string; includeInactive?: boolean } = {}) =>
  (
    await apiRequest<BackendTemplate[]>("/canned-responses", {
      query: {
        size: 200,
        ...(query.q ? { q: query.q } : {}),
        ...(query.includeInactive ? { includeInactive: "true" } : {}),
      },
    })
  ).data;

export const createTemplateRequest = async (body: {
  title: string;
  content: string;
  shortcut?: string;
  scope?: "PERSONAL" | "SHARED";
}) => (await apiRequest<BackendTemplate>("/canned-responses", { method: "POST", body })).data;

export const updateTemplateRequest = async (
  id: string,
  body: { title?: string; content?: string; shortcut?: string | null; isActive?: boolean },
) => (await apiRequest<BackendTemplate>(`/canned-responses/${id}`, { method: "PATCH", body })).data;

export const deactivateTemplateRequest = async (id: string) =>
  (await apiRequest<BackendTemplate>(`/canned-responses/${id}`, { method: "DELETE" })).data;
