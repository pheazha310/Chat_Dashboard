import type { AuthContext } from "@shared/auth/auth.types.js";
import { can, type Permission } from "@shared/auth/permissions.js";
import { ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import type { AutomationRepository } from "./automation.repository.js";
import type { AutoResponsesInput, TrainingExampleInput } from "./automation.schema.js";
import type { AutoResponsesDto, TrainingExampleDto, TrainingStatus } from "./automation.types.js";

const MANAGE: Permission = "automation.manage";

interface ExampleRow {
  id: string;
  customerMessage: string;
  suggestedReply: string;
  status: string;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
}

const toExample = (row: ExampleRow): TrainingExampleDto => ({
  id: row.id,
  customerMessage: row.customerMessage,
  suggestedReply: row.suggestedReply,
  status: row.status as TrainingStatus,
  createdBy: row.createdBy,
  approvedBy: row.approvedBy,
  approvedAt: row.approvedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

/**
 * The team's automatic replies and the AI training examples. Everyone on staff can read both and propose an example;
 * saving the replies and approving examples needs `automation.manage` (supervisors and admins).
 */
export class AutomationService {
  constructor(
    private readonly repository: AutomationRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  getAutoResponses(): Promise<AutoResponsesDto> {
    return this.repository.findAutoResponses();
  }

  async saveAutoResponses(auth: AuthContext, input: AutoResponsesInput): Promise<AutoResponsesDto> {
    this.requireManage(auth, "Only supervisors can change the automatic replies");
    await this.repository.saveAutoResponses(auth.userId, input);
    return this.repository.findAutoResponses();
  }

  async listExamples(): Promise<TrainingExampleDto[]> {
    return (await this.repository.listExamples()).map(toExample);
  }

  async addExample(auth: AuthContext, input: TrainingExampleInput): Promise<TrainingExampleDto> {
    return toExample(await this.repository.createExample(auth.userId, input));
  }

  async setApproval(auth: AuthContext, id: string, approved: boolean): Promise<TrainingExampleDto> {
    this.requireManage(auth, "Only supervisors can approve training examples");
    const row = await this.repository.setApproval(id, approved ? { by: auth.userId, at: this.clock() } : null);
    if (!row) throw new NotFoundError("Training example not found");
    return toExample(row);
  }

  private requireManage(auth: AuthContext, message: string) {
    if (!can(auth, MANAGE)) throw new ForbiddenError(message);
  }
}
