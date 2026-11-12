import { describe, expect, it } from "vitest";
import { toApplicationDto, type LosApplication } from "./los-application";

const application: LosApplication = {
  id: 731,
  status: "REQUEST_REVIEWING",
  ticketNumber: "LN-000123",
  appliedDate: "2026-11-10T14:05:00.000Z",
  loanDetail: {
    loanPurpose: "Business",
    requestedLoanSize: 500,
    requestedLoanTerm: 30,
    cycle: 1,
  },
};

describe("toApplicationDto", () => {
  it("maps the LOS application onto the application panel", () => {
    expect(toApplicationDto(application)).toMatchObject({
      appId: "731",
      product: "Business",
      amount: "$500",
      tenor: "30 days",
      status: "Reviewing",
      reference: "LN-000123",
    });
  });

  it("shows the requested amount and tenor, not the approved ones", () => {
    const result = toApplicationDto({
      ...application,
      loanDetail: { ...application.loanDetail, approvedLoanSize: 400, approvedLoanTerm: 15 },
    });
    expect(result.amount).toBe("$500");
    expect(result.tenor).toBe("30 days");
  });

  it("uses a dash for what LOS did not send", () => {
    const result = toApplicationDto({ id: 9, status: "DRAFT_NEW" });
    expect(result).toMatchObject({ appId: "9", product: "—", amount: "—", tenor: "—", reference: "9" });
  });

  it("writes one day as singular", () => {
    expect(toApplicationDto({ ...application, loanDetail: { requestedLoanTerm: 1 } }).tenor).toBe("1 day");
  });

  it.each([
    ["DRAFT_NEW", "New"],
    ["REQUEST_NEW", "New"],
    ["DRAFT_REVIEWING", "Reviewing"],
    ["DRAFT_SUBMITTED_REVIEWING", "Reviewing"],
    ["REQUEST_REVIEWING", "Reviewing"],
    ["REQUEST_RECOMMENDED", "Reviewing"],
    ["REQUEST_APPROVED", "Completed"],
    ["DEPOSIT_COMPLETED", "in progress"],
    ["REPAYMENT_COMPLETED", "Paid Off"],
    ["DRAFT_FAILED_AUTO", "Failed"],
    ["DRAFT_FAILED_MANUAL", "Failed"],
  ])("maps LOS status %s to %s", (status, expected) => {
    expect(toApplicationDto({ ...application, status }).status).toBe(expected);
  });

  it("does not guess for a status it does not know", () => {
    expect(toApplicationDto({ ...application, status: "SOMETHING_NEW" }).status).toBe("Unknown");
  });
});
