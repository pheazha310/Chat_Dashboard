import { prisma, type Db } from "@config/database.js";
import type { LosApplicationSummary } from "./los-data.client.js";

export class LoanApplicationRepository {
  constructor(private readonly db: Db = prisma) {}

  /** Creates or refreshes the snapshot of one application. */
  async upsert(customerId: string, application: LosApplicationSummary): Promise<void> {
    const { id, ...fields } = application;
    const data = { customerId, ...fields, fetchedAt: new Date() };
    await this.db.loanApplicationSnapshot.upsert({
      where: { applicationId: id },
      create: { applicationId: id, ...data },
      update: data,
    });
  }

  find(applicationId: number) {
    return this.db.loanApplicationSnapshot.findUnique({ where: { applicationId } });
  }
}
