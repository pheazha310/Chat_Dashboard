import { create } from "zustand";
import {
  createTrainingExampleRequest,
  getAutoResponses,
  listTrainingExamples,
  saveAutoResponsesRequest,
  setTrainingApprovalRequest,
  type AutoResponses,
  type TrainingExample,
} from "@/shared/api/rest";
import { notify } from "@/shared/ui";

type AutomationState = {
  /** What the team saved; null texts mean nothing is sent yet. Null until the first load. */
  autoResponses: AutoResponses | null;
  examples: TrainingExample[];
  status: "idle" | "loading" | "ready" | "error";
};

/** The team-wide automatic replies and AI training examples, as the backend holds them (docs/api-automation.md). */
export const useAutomationStore = create<AutomationState>(() => ({
  autoResponses: null,
  examples: [],
  status: "idle",
}));

const failure = (error: unknown, fallback: string) => notify(error instanceof Error ? error.message : fallback);

export async function loadAutomation() {
  useAutomationStore.setState({ status: "loading" });
  try {
    const [autoResponses, examples] = await Promise.all([getAutoResponses(), listTrainingExamples()]);
    useAutomationStore.setState({ autoResponses, examples, status: "ready" });
  } catch {
    useAutomationStore.setState({ status: "error" });
  }
}

export async function saveAutoResponses(texts: { awayMessage: string; firstResponse: string }) {
  try {
    useAutomationStore.setState({ autoResponses: await saveAutoResponsesRequest(texts) });
    return true;
  } catch (error) {
    failure(error, "Could not save the automatic replies");
    return false;
  }
}

export async function addTrainingExample(customerMessage: string, suggestedReply: string) {
  try {
    const created = await createTrainingExampleRequest(customerMessage, suggestedReply);
    useAutomationStore.setState((state) => ({ examples: [created, ...state.examples] }));
    return true;
  } catch (error) {
    failure(error, "Could not add the example");
    return false;
  }
}

export async function setTrainingApproval(id: string, approved: boolean) {
  try {
    const updated = await setTrainingApprovalRequest(id, approved);
    useAutomationStore.setState((state) => ({
      examples: state.examples.map((example) => (example.id === id ? updated : example)),
    }));
  } catch (error) {
    failure(error, "Could not change the approval");
    void loadAutomation();
  }
}
