import { idToString } from "@shared/utils/ids.js";
import type { AssignmentDto, AssignmentRow } from "./assignment.types.js";

const id = (value: bigint | null) => (value === null ? null : idToString(value));

export const toAssignment = (row: AssignmentRow): AssignmentDto => ({
  id: idToString(row.id),
  conversationId: idToString(row.conversationId),
  agentId: idToString(row.agentId),
  assignedBy: id(row.assignedBy),
  type: row.assignmentType,
  action: row.assignmentAction,
  note: row.note,
  assignedAt: row.assignedAt.toISOString(),
  endedAt: row.endedAt?.toISOString() ?? null,
  endedBy: id(row.endedBy),
});
