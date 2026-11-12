import { describe, expect, it, vi } from "vitest";
import { AppError } from "@shared/errors/AppError.js";
import { BearerTokenAuth, LosDataClient, NoLosServiceAuth, type LosServiceAuth } from "../los-data.client.js";

const BASE = "https://api-dev.los.delightech.asia/api/v1";
// The real path is not defined by LOS yet (only "/integration/chat/*" is announced), so the client is given it.
const applicationPath = (id: number) => `/test-path/application/${id}`;
const auth: LosServiceAuth = { headers: async () => ({ "x-api-key": "secret-key" }) };
const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("LosDataClient", () => {
  it("reads an application with the strategy's headers and returns the fields chat uses", async () => {
    const fetcher = vi.fn(() =>
      reply({
        status: "success",
        data: {
          id: 4821,
          status: "SOME_NEW_STATUS",
          ticketNumber: "LN-000123",
          appliedDate: "2026-11-10T14:05:00.000Z",
          phone: "012345678",
          loanDetail: { loanPurpose: "Business", requestedLoanSize: 500, requestedLoanTerm: 30, cycle: 1 },
        },
      }),
    );
    const client = new LosDataClient({ baseUrl: BASE, applicationPath, auth, fetcher });

    const application = await client.getApplication(4821);

    expect(fetcher).toHaveBeenCalledWith(
      `${BASE}/test-path/application/4821`,
      expect.objectContaining({
        headers: expect.objectContaining({ "x-api-key": "secret-key" }),
      }),
    );
    // Status stays an open string; the customer's phone is not copied.
    expect(application).toEqual({
      id: 4821,
      status: "SOME_NEW_STATUS",
      ticketNumber: "LN-000123",
      appliedDate: "2026-11-10T14:05:00.000Z",
      loanPurpose: "Business",
      requestedLoanSize: 500,
      requestedLoanTerm: 30,
    });
  });

  it("returns null for an application LOS does not know", async () => {
    const client = new LosDataClient({
      baseUrl: BASE,
      applicationPath,
      auth,
      fetcher: () => reply({ status: "error" }, 404),
    });
    await expect(client.getApplication(1)).resolves.toBeNull();
  });

  it("is unavailable (503) until LOS provides service authentication, and makes no request", async () => {
    const fetcher = vi.fn();
    const client = new LosDataClient({ baseUrl: BASE, applicationPath, auth: new NoLosServiceAuth(), fetcher });
    await expect(client.getApplication(1)).rejects.toMatchObject({ status: 503, code: "LOS_DATA_UNAVAILABLE" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps LOS failures, timeouts and malformed answers to 502/504 without leaking the key or LOS's body", async () => {
    const failing = (fetcher: () => Promise<Response>) =>
      new LosDataClient({ baseUrl: BASE, applicationPath, auth, fetcher });

    const down = await failing(() => reply({ message: "secret-key stack trace" }, 500))
      .getApplication(1)
      .catch((e: unknown) => e);
    expect(down).toMatchObject({ status: 502, code: "LOS_DATA_ERROR" });
    expect(JSON.stringify(down)).not.toContain("secret-key");
    expect((down as AppError).message).not.toContain("stack trace");

    await expect(
      failing(() => Promise.reject(Object.assign(new Error("t"), { name: "TimeoutError" }))).getApplication(1),
    ).rejects.toMatchObject({ status: 504, code: "LOS_DATA_TIMEOUT" });
    await expect(failing(() => reply({ data: { id: "x" } })).getApplication(1)).rejects.toMatchObject({ status: 502 });
  });

  it("refuses a malformed application id", async () => {
    const client = new LosDataClient({ baseUrl: BASE, applicationPath, auth, fetcher: vi.fn() });
    await expect(client.getApplication(0)).rejects.toBeInstanceOf(AppError);
  });

  describe("the customer's own latest application", () => {
    const answer = {
      status: "success",
      data: { id: 9, status: "REQUEST_NEW", loanDetail: { loanPurpose: "Business", requestedLoanSize: 500 } },
    };

    it("calls LOS's customer endpoint with the customer's own token as a bearer", async () => {
      const fetcher = vi.fn(() => reply(answer));
      const client = new LosDataClient({
        baseUrl: BASE,
        applicationPath,
        auth: new BearerTokenAuth("cust.jwt.token"),
        fetcher,
      });

      await expect(client.getLatestApplication()).resolves.toMatchObject({ id: 9, requestedLoanSize: 500 });

      expect(fetcher).toHaveBeenCalledWith(
        `${BASE}/customer/application/latest`,
        expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer cust.jwt.token" }) }),
      );
    });

    it("answers null when the customer has no application, and refuses an empty token", async () => {
      const none = new LosDataClient({
        baseUrl: BASE,
        applicationPath,
        auth,
        fetcher: () => reply({ status: "success", data: null }),
      });
      await expect(none.getLatestApplication()).resolves.toBeNull();
      expect(() => new BearerTokenAuth("")).toThrow();
    });
  });
});
