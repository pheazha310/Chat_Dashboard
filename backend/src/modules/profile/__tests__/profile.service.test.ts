import { fromPartial } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@shared/errors/AppError.js";
import type { AuthContext } from "@shared/auth/auth.types.js";
import type { ConversationService } from "@modules/conversations/conversation.service.js";
import type { PresenceService } from "@modules/presence/presence.service.js";
import { ProfileService } from "../profile.service.js";
import { uid } from "../../../__tests__/support/ids.js";

vi.mock("@config/logger.js", () => ({ logger: { warn: vi.fn() } }));

const directory = { source: "test", getAgents: vi.fn(), getCustomer: vi.fn() };
const presence = { snapshot: vi.fn() };
const conversations = { list: vi.fn(), listForCustomer: vi.fn() };
const service = new ProfileService(
  directory,
  fromPartial<PresenceService>(presence),
  fromPartial<ConversationService>(conversations),
);

const agent: AuthContext = { userId: uid(1), role: "AGENT", chatUserId: uid(900) };
const customer: AuthContext = { userId: uid(100), role: "CUSTOMER", chatUserId: uid(901) };

beforeEach(() => {
  vi.resetAllMocks();
  directory.getAgents.mockResolvedValue([{ id: uid(1), name: "Sarah", avatarUrl: null }]);
  presence.snapshot.mockResolvedValue([{ userId: uid(1), status: "BUSY" }]);
});

describe("agentMe", () => {
  it("returns the token identity with the Backend 1 profile and the chosen availability", async () => {
    expect(await service.agentMe(agent)).toEqual({
      userId: uid(1),
      chatUserId: uid(900),
      role: "AGENT",
      profile: { id: uid(1), name: "Sarah", avatarUrl: null },
      availability: "BUSY",
    });
  });

  it("still answers when Backend 1 or presence is down", async () => {
    directory.getAgents.mockRejectedValue(new Error("down"));
    presence.snapshot.mockRejectedValue(new Error("redis"));
    expect(await service.agentMe(agent)).toMatchObject({ profile: null, availability: "OFFLINE" });
  });

  it("is OFFLINE when the agent has no open socket", async () => {
    presence.snapshot.mockResolvedValue([]);
    expect((await service.agentMe(agent)).availability).toBe("OFFLINE");
  });
});

describe("agentConversations", () => {
  it("is always the 'mine' inbox filter", async () => {
    await service.agentConversations(agent, { page: 2, size: 10, tagMatch: "any", sort: "recent" });
    expect(conversations.list).toHaveBeenCalledWith(agent, expect.objectContaining({ filter: "mine", page: 2 }));
  });
});

describe("customerMe", () => {
  it("shows only what a customer may see about themselves", async () => {
    directory.getCustomer.mockResolvedValue({
      id: uid(100),
      name: "Maya",
      avatarUrl: null,
      blacklisted: true,
      email: "m@example.test",
      phone: "+1",
      nationalId: "SECRET",
      occupation: "x",
      salary: "9",
    });
    const me = await service.customerMe(customer);
    expect(me).toEqual({
      userId: uid(100),
      chatUserId: uid(901),
      name: "Maya",
      avatarUrl: null,
      email: "m@example.test",
      phone: "+1",
    });
    expect(me).not.toHaveProperty("nationalId");
    expect(me).not.toHaveProperty("blacklisted");
    expect(directory.getCustomer).toHaveBeenCalledWith(uid(100));
  });

  it("is 404 when Backend 1 does not know the customer", async () => {
    directory.getCustomer.mockResolvedValue(null);
    await expect(service.customerMe(customer)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("customerConversations", () => {
  it("lists only the token's own conversations", async () => {
    conversations.listForCustomer.mockResolvedValue({ items: [], meta: {} });
    await service.customerConversations(customer, { page: 1, size: 25 });
    expect(conversations.listForCustomer).toHaveBeenCalledWith(uid(100), { page: 1, size: 25 });
  });
});
