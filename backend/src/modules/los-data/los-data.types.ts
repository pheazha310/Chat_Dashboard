/** What chat shows about a customer's loan application (docs/api-conversations.md). */
export interface LoanApplicationDto {
  applicationId: number;
  /** LOS status as is: an open string. */
  status: string;
  ticketNumber: string | null;
  /** As LOS sends it (Cambodia local time labelled `Z`); not converted. */
  appliedDate: string | null;
  loanPurpose: string | null;
  /** USD */
  requestedLoanSize: number | null;
  /** Days */
  requestedLoanTerm: number | null;
  /** When chat read it from LOS (true UTC): how fresh the data is. */
  fetchedAt: string;
}
