import type { ApplicationDto, ApplicationStatus } from "../ws/protocol";

/**
 * A loan application as LOS returns it (LOS integration pack, section 3.3). Only the fields the application panel
 * uses; every `loanDetail` field may be missing. The pack's sample is illustrative, so check it against a real response.
 */
export type LosApplication = {
  id: number;
  status: string;
  ticketNumber?: string | null;
  appliedDate?: string | null;
  loanDetail?: {
    loanPurpose?: string | null;
    /** USD */
    requestedLoanSize?: number | null;
    /** Days */
    requestedLoanTerm?: number | null;
    approvedLoanSize?: number | null;
    approvedLoanTerm?: number | null;
    cycle?: number | null;
  } | null;
};

const UNKNOWN = "—";

/**
 * LOS statuses to the panel's status. LOS has more statuses than the pack lists, so anything not listed here is
 * "Unknown" rather than a guess. PROPOSED mapping: confirm the wording with the business owner.
 */
const STATUS: Readonly<Record<string, ApplicationStatus>> = {
  DRAFT_NEW: "New",
  REQUEST_NEW: "New",
  DRAFT_REVIEWING: "Reviewing",
  DRAFT_SUBMITTED: "Reviewing",
  DRAFT_SUBMITTED_REVIEWING: "Reviewing",
  DRAFT_AMENDING: "Reviewing",
  REQUEST_REVIEWING: "Reviewing",
  REQUEST_RECOMMENDED: "Reviewing",
  REQUEST_APPROVED: "Completed",
  DEPOSIT_COMPLETED: "in progress",
  REPAYMENT_COMPLETED: "Paid Off",
  DRAFT_FAILED_AUTO: "Failed",
  DRAFT_FAILED_MANUAL: "Failed",
};

const money = (value: number | null | undefined) =>
  typeof value === "number" ? `$${value.toLocaleString("en-US")}` : UNKNOWN;

const days = (value: number | null | undefined) =>
  typeof value === "number" ? `${value} ${value === 1 ? "day" : "days"}` : UNKNOWN;

/** The panel shows what the customer asked for: the requested amount and tenor, not the approved ones. */
export function toApplicationDto(source: LosApplication): ApplicationDto {
  const appId = String(source.id);
  const detail = source.loanDetail ?? {};
  return {
    appId,
    product: detail.loanPurpose || UNKNOWN,
    amount: money(detail.requestedLoanSize),
    tenor: days(detail.requestedLoanTerm),
    status: Object.prototype.hasOwnProperty.call(STATUS, source.status)
      ? (STATUS[source.status] as ApplicationStatus)
      : "Unknown",
    reference: source.ticketNumber || appId,
    ...(source.appliedDate ? { registeredAt: source.appliedDate } : {}),
  };
}
