import { apiRequest } from "./client";

/** The team's automatic replies; a text is null until it has been saved (docs/api-automation.md). */
export type AutoResponses = { awayMessage: string | null; firstResponse: string | null };

export type TrainingExample = {
  id: string;
  customerMessage: string;
  suggestedReply: string;
  status: "PENDING" | "APPROVED";
  createdBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
};

export const getAutoResponses = async () => (await apiRequest<AutoResponses>("/automation/auto-responses")).data;

export const saveAutoResponsesRequest = async (texts: { awayMessage: string; firstResponse: string }) =>
  (await apiRequest<AutoResponses>("/automation/auto-responses", { method: "PUT", body: texts })).data;

export const listTrainingExamples = async () =>
  (await apiRequest<TrainingExample[]>("/automation/training-examples")).data;

export const createTrainingExampleRequest = async (customerMessage: string, suggestedReply: string) =>
  (
    await apiRequest<TrainingExample>("/automation/training-examples", {
      method: "POST",
      body: { customerMessage, suggestedReply },
    })
  ).data;

export const setTrainingApprovalRequest = async (id: string, approved: boolean) =>
  (
    await apiRequest<TrainingExample>(`/automation/training-examples/${id}`, {
      method: "PATCH",
      body: { approved },
    })
  ).data;
