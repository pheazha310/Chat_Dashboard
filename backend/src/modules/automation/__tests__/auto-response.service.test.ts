import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { uid } from "../../../__tests__/support/ids.js";
import type { AutoResponseRepository } from "../auto-response.repository.js";
import { AutoResponseService } from "../auto-response.service.js";

vi.mock("@config/logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const repo = { findActiveRule: vi.fn(), wasSentSince: vi.fn(), log: vi.fn() };
const messages = { postAutomatic: vi.fn() };
const agents = { availableAgentIds: vi.fn() };
const now = Date.parse("2030-01-01T12:00:00Z");
const conversationId = uid(10);
const rule = { id: uid(50), responseContent: "Hello from us" };
let service: AutoResponseService;

beforeEach(() => {
  vi.resetAllMocks();
  repo.findActiveRule.mockResolvedValue(rule);
  repo.wasSentSince.mockResolvedValue(false);
  messages.postAutomatic.mockResolvedValue(uid(70));
  agents.availableAgentIds.mockResolvedValue([]);
  service = new AutoResponseService(
    fromPartial<AutoResponseRepository>(repo),
    () => messages,
    agents,
    () => now,
  );
});

describe("first response", () => {
  it("is sent once when a customer starts a conversation, and logged", async () => {
    await service.conversationStarted(conversationId);

    expect(repo.findActiveRule).toHaveBeenCalledWith("FIRST_RESPONSE");
    expect(messages.postAutomatic).toHaveBeenCalledWith(conversationId, "Hello from us", {
      automatic: true,
      trigger: "FIRST_RESPONSE",
    });
    expect(repo.log).toHaveBeenCalledWith({
      ruleId: rule.id,
      conversationId,
      messageId: uid(70),
      executionStatus: "SUCCESS",
    });
  });

  it("sends nothing until the team has saved a text", async () => {
    repo.findActiveRule.mockResolvedValue(null);
    await service.conversationStarted(conversationId);
    expect(messages.postAutomatic).not.toHaveBeenCalled();
  });

  it("is never sent twice to the same conversation", async () => {
    repo.wasSentSince.mockResolvedValue(true);
    await service.conversationStarted(conversationId);
    expect(repo.wasSentSince).toHaveBeenCalledWith(rule.id, conversationId, null);
    expect(messages.postAutomatic).not.toHaveBeenCalled();
  });

  it("does not record a sent message as failed when only the log write fails", async () => {
    repo.log.mockRejectedValue(new Error("log down"));
    await expect(service.conversationStarted(conversationId)).resolves.toBeUndefined();
    expect(messages.postAutomatic).toHaveBeenCalledTimes(1);
    expect(repo.log).toHaveBeenCalledTimes(1);
  });

  it("never fails the customer: a failed send is logged and swallowed", async () => {
    messages.postAutomatic.mockRejectedValue(new Error("db down"));
    await expect(service.conversationStarted(conversationId)).resolves.toBeUndefined();
    expect(repo.log).toHaveBeenCalledWith({
      ruleId: rule.id,
      conversationId,
      executionStatus: "FAILED",
      errorMessage: "db down",
    });
  });
});

describe("away message", () => {
  it("is sent when a customer writes and no agent is available", async () => {
    await service.customerMessaged(conversationId);

    expect(repo.findActiveRule).toHaveBeenCalledWith("AWAY");
    expect(messages.postAutomatic).toHaveBeenCalledWith(conversationId, "Hello from us", {
      automatic: true,
      trigger: "AWAY",
    });
    expect(repo.log).toHaveBeenCalledWith(expect.objectContaining({ executionStatus: "SUCCESS", messageId: uid(70) }));
  });

  it("is not sent while an agent is available", async () => {
    agents.availableAgentIds.mockResolvedValue([uid(1)]);
    await service.customerMessaged(conversationId);
    expect(messages.postAutomatic).not.toHaveBeenCalled();
  });

  it("is sent at most once an hour per conversation", async () => {
    repo.wasSentSince.mockResolvedValue(true);
    await service.customerMessaged(conversationId);
    expect(repo.wasSentSince).toHaveBeenCalledWith(rule.id, conversationId, new Date(now - 60 * 60 * 1000));
    expect(messages.postAutomatic).not.toHaveBeenCalled();
  });
});
