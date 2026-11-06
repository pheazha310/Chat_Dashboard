import { createHmac } from "node:crypto";
import { ConflictError, ForbiddenError, NotFoundError } from "@shared/errors/AppError.js";
import { isSupervisor, type AuthContext } from "@shared/auth/auth.types.js";
import { isOwner } from "@shared/policy/conversation-access.js";
import type {
  AccessibleConversationState,
  ConversationAccess,
  CustomerConversationAccess,
} from "@shared/ports/conversation-access.js";
import type { CustomerGuard } from "@shared/ports/moderation.js";
import type { RealtimeNotifier } from "@shared/ports/realtime.js";
import { bestEffort } from "@shared/utils/best-effort.js";
import { idToString } from "@shared/utils/ids.js";
import { pageMeta, type PageQuery } from "@shared/utils/pagination.js";
import type { NotifyAgentInput } from "@modules/notifications/notification.types.js";
import { isUniqueViolation, type CallRepository, type CallRow } from "./call.repository.js";
import type { CandidateSignal, SdpSignal, StartCallInput } from "./call.schema.js";
import {
  DEFAULT_CALL_OPTIONS,
  type CallActor,
  type CallDto,
  type CallOptions,
  type CallStatus,
  type CallType,
  type IceConfig,
  type IceServer,
  type PartyType,
  type SignalKind,
} from "./call.types.js";

/** The slice of the notification service this module needs. */
export interface CallNotifier {
  notifyAgent(input: NotifyAgentInput): Promise<boolean>;
}

type Access = ConversationAccess & CustomerConversationAccess;
const BATCH = 100;

const NO_ICE: IceConfig = { stunUrls: [], turnUrls: [], turnTtlSeconds: 3600 };

/**
 * Voice and video calls between an agent and a customer. The backend only does signalling and bookkeeping: it records
 * the call, decides who may start, answer, end and exchange session descriptions, and relays those descriptions. The
 * media itself flows directly between the two browsers (WebRTC) and never touches this server.
 *
 * Order of a call: the caller starts it (RINGING), the callee accepts (ACTIVE), then the caller sends the offer, the
 * callee the answer, and both send ICE candidates. Nothing is relayed before the call is answered, so a session
 * description is never held or sent to anyone who has not accepted.
 *
 * Customers cannot reach the dashboard API or socket (they get their own channel, not built yet), so everything a
 * customer does is a service method here, like `MessageService.receiveFromCustomer`.
 */
export class CallService {
  constructor(
    private readonly repository: CallRepository,
    private readonly conversations: () => Access,
    private readonly notifications: CallNotifier,
    private readonly realtime: RealtimeNotifier,
    private readonly options: CallOptions = DEFAULT_CALL_OPTIONS,
    private readonly ice: IceConfig = NO_ICE,
    private readonly clock: () => Date = () => new Date(),
    private readonly guard?: () => CustomerGuard,
  ) {}

  // ─── reading ───────────────────────────────────────────────────────────────

  async listForConversation(auth: AuthContext, conversationId: string, query: PageQuery) {
    const state = await this.conversations().requireVisible(auth, conversationId);
    const [rows, total] = await this.repository.list(conversationId, (query.page - 1) * query.size, query.size);
    return {
      items: rows.map((row) => this.present(row, { type: "AGENT", auth }, state)),
      meta: pageMeta(total, query),
    };
  }

  async get(auth: AuthContext, callId: string): Promise<CallDto> {
    const { row, state } = await this.load({ type: "AGENT", auth }, callId);
    return this.present(row, { type: "AGENT", auth }, state);
  }

  /**
   * What the browser needs to set up a connection. TURN credentials are short-lived when a shared secret is
   * configured (coturn `use-auth-secret`), so a leaked credential stops working within the hour.
   */
  iceServers(auth: AuthContext): { iceServers: IceServer[]; ringTimeoutSeconds: number } {
    const servers: IceServer[] = [];
    if (this.ice.stunUrls.length > 0) servers.push({ urls: this.ice.stunUrls });
    if (this.ice.turnUrls.length > 0) {
      if (this.ice.turnSecret) {
        const expires = Math.floor(this.clock().getTime() / 1000) + this.ice.turnTtlSeconds;
        const username = `${expires}:${auth.userId}`;
        const credential = createHmac("sha1", this.ice.turnSecret).update(username).digest("base64");
        servers.push({ urls: this.ice.turnUrls, username, credential });
      } else if (this.ice.turnUsername && this.ice.turnCredential) {
        servers.push({ urls: this.ice.turnUrls, username: this.ice.turnUsername, credential: this.ice.turnCredential });
      }
    }
    return { iceServers: servers, ringTimeoutSeconds: Math.round(this.options.ringTimeoutMs / 1000) };
  }

  // ─── starting ──────────────────────────────────────────────────────────────

  /** An agent calls the conversation's customer. Only the owner of a conversation that is not closed. */
  async start(auth: AuthContext, conversationId: string, input: StartCallInput): Promise<CallDto> {
    const state = await this.conversations().requireVisible(auth, conversationId);
    if (!isOwner(auth, state) || state.status === "CLOSED") {
      throw new ForbiddenError("Only the agent who owns an open conversation can call the customer");
    }
    if (state.customerId === null) throw new ConflictError("This conversation has no customer to call");
    const row = await this.create(
      state,
      input.callType,
      { type: "AGENT", id: auth.userId },
      {
        type: "CUSTOMER",
        id: state.customerId,
      },
    );
    await this.activity(row, { type: "AGENT", id: auth.userId }, "Call started", "started");
    // The customer's channel receives it as soon as it exists.
    await this.toUser(state.customerId, "call.incoming", row);
    return this.present(row, { type: "AGENT", auth }, state);
  }

  /** A customer calls. The customer channel will use this; every agent who may see the conversation is alerted. */
  async initiateFromCustomer(input: { customerId: string; conversationId: string; callType: CallType }) {
    const state = await this.conversations().requireForCustomer(input.customerId, input.conversationId);
    if (state.status === "CLOSED") throw new ConflictError("This conversation is closed");
    if (await this.guard?.().isBlocked(input.customerId)) throw new ForbiddenError("This customer is blocked");
    const row = await this.create(state, input.callType, { type: "CUSTOMER", id: input.customerId }, null);
    await this.activity(row, { type: "CUSTOMER", id: input.customerId }, "Incoming call", "started");
    await bestEffort("realtime call.incoming", () =>
      this.realtime.messageEvent(row.conversationId, "call.incoming", { call: toPublic(row) }),
    );
    return toPublic(row);
  }

  // ─── answering and ending (agent) ──────────────────────────────────────────

  accept(auth: AuthContext, callId: string) {
    return this.answer({ type: "AGENT", auth }, callId, "accept");
  }
  decline(auth: AuthContext, callId: string) {
    return this.answer({ type: "AGENT", auth }, callId, "decline");
  }
  cancel(auth: AuthContext, callId: string) {
    return this.cancelCall({ type: "AGENT", auth }, callId);
  }
  end(auth: AuthContext, callId: string) {
    return this.endCall({ type: "AGENT", auth }, callId);
  }

  // ─── answering and ending (customer; the customer channel calls these) ─────

  acceptByCustomer(customerId: string, callId: string) {
    return this.answer({ type: "CUSTOMER", id: customerId }, callId, "accept");
  }
  declineByCustomer(customerId: string, callId: string) {
    return this.answer({ type: "CUSTOMER", id: customerId }, callId, "decline");
  }
  cancelByCustomer(customerId: string, callId: string) {
    return this.cancelCall({ type: "CUSTOMER", id: customerId }, callId);
  }
  endByCustomer(customerId: string, callId: string) {
    return this.endCall({ type: "CUSTOMER", id: customerId }, callId);
  }

  // ─── signalling ────────────────────────────────────────────────────────────

  /**
   * Passes a session description or ICE candidate to the other side of an answered call. The sender must be one of
   * the two parties who joined; the caller sends the offer and the callee the answer. Nothing is stored.
   */
  async relay(actor: CallActor, kind: SignalKind, data: SdpSignal | CandidateSignal): Promise<void> {
    const row = await this.repository.findById(data.callId);
    if (!row) throw new NotFoundError("Call not found");
    const me = row.callParticipants.find((p) => p.joinedAt !== null && isActor(actor, p));
    if (!me) throw new ForbiddenError("You are not a participant of this call");
    if (row.status !== "ACTIVE") throw new ConflictError("The call is not in progress");

    const iAmCaller = row.initiatedByType === me.participantType && row.initiatedById === me.participantId;
    if (kind === "offer" && !iAmCaller) throw new ForbiddenError("Only the caller sends the offer");
    if (kind === "answer" && iAmCaller) throw new ForbiddenError("Only the callee sends the answer");

    const other = row.callParticipants.find((p) => p !== me && p.joinedAt !== null && p.leftAt === null);
    if (!other) throw new ConflictError("The other side has left the call");

    const { callId: _callId, ...rest } = data;
    await this.realtime.agentEvent(other.participantId, `call.${kind}`, {
      callId: idToString(row.id),
      from: { type: me.participantType, id: idToString(me.participantId) },
      ...rest,
    });
  }

  // ─── the job ───────────────────────────────────────────────────────────────

  /**
   * Marks calls nobody answered in time as MISSED and ends calls that never finished. Several instances can run it
   * at once: every call is claimed in one statement, so each is handled once.
   */
  async processDue(now: Date = this.clock()): Promise<{ missed: number; ended: number }> {
    const missed = await this.repository.claimUnanswered(new Date(now.getTime() - this.options.ringTimeoutMs), BATCH);
    for (const row of missed) await this.closedBySystem(row, "missed", "Call not answered");
    const ended = await this.repository.claimOverlong(new Date(now.getTime() - this.options.maxDurationMs), BATCH);
    for (const row of ended) await this.closedBySystem(row, "timeout", "Call ended automatically");
    return { missed: missed.length, ended: ended.length };
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  private async create(
    state: AccessibleConversationState,
    callType: CallType,
    initiator: { type: PartyType; id: string },
    callee: { type: PartyType; id: string } | null,
  ): Promise<CallRow> {
    if (await this.repository.findOpen(state.id)) throw new ConflictError("This conversation already has a call");
    try {
      return await this.repository.create({ conversationId: state.id, callType, initiator, callee });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError("This conversation already has a call");
      throw error;
    }
  }

  private async answer(actor: CallActor, callId: string, action: "accept" | "decline"): Promise<CallDto> {
    const { row, state } = await this.load(actor, callId);
    if (row.status !== "RINGING") throw new ConflictError("This call is no longer ringing");
    if (!canAnswer(actor, row, state)) {
      throw new ForbiddenError(
        row.initiatedByType === "AGENT"
          ? "Only the customer can answer a call an agent started"
          : "Only an agent who handles this conversation can answer",
      );
    }

    const updated = await this.repository.inTransaction(async (tx) => {
      if (action === "accept") {
        if (!(await tx.activate(callId))) throw new ConflictError("This call was answered or ended by someone else");
        await tx.join(callId, partyOf(actor));
      } else if (!(await tx.finish(callId, ["RINGING"], "DECLINED"))) {
        throw new ConflictError("This call was answered or ended by someone else");
      }
      await tx.addActivity(
        row.conversationId,
        partyOf(actor),
        action === "accept" ? "Call answered" : "Call declined",
        { callId, action: action === "accept" ? "answered" : "declined" },
      );
      return (await tx.findById(callId)) as CallRow;
    });
    await this.announce(action === "accept" ? "call.accepted" : "call.declined", updated, {
      by: { type: partyOf(actor).type, id: partyOf(actor).id },
    });
    return this.present(updated, actor, state);
  }

  private async cancelCall(actor: CallActor, callId: string): Promise<CallDto> {
    const { row, state } = await this.load(actor, callId);
    const party = partyOf(actor);
    if (row.initiatedByType !== party.type || row.initiatedById !== party.id) {
      throw new ForbiddenError("Only the caller can cancel a call");
    }
    if (row.status !== "RINGING") throw new ConflictError("Only a ringing call can be cancelled");
    const updated = await this.finishWith(row, ["RINGING"], "CANCELLED", party, "Call cancelled", "cancelled");
    await this.announce("call.ended", updated, { reason: "cancelled" });
    return this.present(updated, actor, state);
  }

  private async endCall(actor: CallActor, callId: string): Promise<CallDto> {
    const { row, state } = await this.load(actor, callId);
    const party = partyOf(actor);
    const joined = row.callParticipants.some((p) => p.joinedAt !== null && isActor(actor, p));
    if (!joined && !(actor.type === "AGENT" && isSupervisor(actor.auth))) {
      throw new ForbiddenError("Only a participant or a supervisor can end a call");
    }
    if (row.status !== "ACTIVE") {
      throw new ConflictError(
        row.status === "RINGING" ? "The call has not been answered; cancel it instead" : "The call is over",
      );
    }
    const updated = await this.finishWith(row, ["ACTIVE"], "ENDED", party, "Call ended", "ended");
    await this.announce("call.ended", updated, { reason: "ended" });
    return this.present(updated, actor, state);
  }

  private async finishWith(
    row: CallRow,
    from: ("RINGING" | "ACTIVE")[],
    to: "ENDED" | "CANCELLED",
    actor: { type: PartyType; id: string },
    description: string,
    action: string,
  ): Promise<CallRow> {
    return this.repository.inTransaction(async (tx) => {
      if (!(await tx.finish(row.id, from, to))) throw new ConflictError("The call is already over");
      const updated = (await tx.findById(row.id)) as CallRow;
      await tx.addActivity(row.conversationId, actor, description, {
        callId: row.id,
        action,
        ...(updated.startedAt && updated.endedAt ? { durationSeconds: String(seconds(updated)) } : {}),
      });
      return updated;
    });
  }

  private async closedBySystem(row: CallRow, reason: "missed" | "timeout", description: string) {
    await bestEffort("call activity", () =>
      this.repository.addActivity(row.conversationId, { type: "SYSTEM", id: null }, description, {
        callId: row.id,
        action: reason,
      }),
    );
    await this.announce("call.ended", row, { reason });
    // A customer who rang and got no answer is a missed call for the agent who owns the conversation.
    if (reason === "missed" && row.initiatedByType === "CUSTOMER") await this.notifyMissed(row);
  }

  private async notifyMissed(row: CallRow) {
    const customer = row.callParticipants.find((p) => p.participantType === "CUSTOMER");
    if (!customer) return;
    await bestEffort("missed call notification", async () => {
      const state = await this.conversations().requireForCustomer(customer.participantId, row.conversationId);
      if (state.assignedAgentId) {
        await this.notifications.notifyAgent({
          agentId: state.assignedAgentId,
          type: "CALL",
          title: "Missed call",
          body: "A customer called and nobody answered",
          conversationId: row.conversationId,
        });
      }
    });
  }

  /** Loads a call for someone allowed to know it exists; others get 404. */
  private async load(actor: CallActor, callId: string) {
    const row = await this.repository.findById(callId);
    if (!row) throw new NotFoundError("Call not found");
    const state =
      actor.type === "AGENT"
        ? await this.conversations().requireVisible(actor.auth, row.conversationId)
        : await this.conversations().requireForCustomer(actor.id, row.conversationId);
    return { row, state };
  }

  private present(row: CallRow, actor: CallActor, state: AccessibleConversationState): CallDto {
    const ringing = row.status === "RINGING";
    const mayAnswer = ringing && canAnswer(actor, row, state);
    const party = partyOf(actor);
    const caller = row.initiatedByType === party.type && row.initiatedById === party.id;
    const agent = actor.type === "AGENT";
    return {
      ...toPublic(row),
      permissions: {
        canAccept: agent && mayAnswer,
        canDecline: agent && mayAnswer,
        canCancel: agent && ringing && caller,
        canEnd:
          agent &&
          row.status === "ACTIVE" &&
          (isSupervisor(actor.auth) || row.callParticipants.some((p) => p.joinedAt !== null && isActor(actor, p))),
      },
    };
  }

  private async activity(row: CallRow, actor: { type: PartyType; id: string }, description: string, action: string) {
    await this.repository.addActivity(row.conversationId, actor, description, {
      callId: row.id,
      action,
      callType: row.callType,
    });
  }

  /** Lifecycle changes go to everyone who may see the conversation (so open windows update) and to the customer. */
  private async announce(type: string, row: CallRow, extra: Record<string, unknown> = {}) {
    const payload = { call: toPublic(row), ...extra };
    await bestEffort(`realtime ${type}`, () => this.realtime.messageEvent(row.conversationId, type, payload));
    const customer = row.callParticipants.find((p) => p.participantType === "CUSTOMER");
    if (customer) await this.toUser(customer.participantId, type, row, extra);
  }

  private toUser(userId: string, type: string, row: CallRow, extra: Record<string, unknown> = {}) {
    return bestEffort(`realtime ${type} to user`, () =>
      this.realtime.agentEvent(userId, type, { call: toPublic(row), ...extra }),
    );
  }
}

const seconds = (row: CallRow) =>
  row.startedAt && row.endedAt ? Math.max(0, Math.round((row.endedAt.getTime() - row.startedAt.getTime()) / 1000)) : 0;

const partyOf = (actor: CallActor): { type: PartyType; id: string } =>
  actor.type === "AGENT" ? { type: "AGENT", id: actor.auth.userId } : { type: "CUSTOMER", id: actor.id };

const isActor = (actor: CallActor, participant: { participantType: string; participantId: string }) => {
  const party = partyOf(actor);
  return participant.participantType === party.type && participant.participantId === party.id;
};

/**
 * Who may answer. A call an agent started is answered by that conversation's customer. A call a customer started can
 * be answered by a supervisor, the owner, or any agent while nobody owns the conversation.
 */
function canAnswer(actor: CallActor, row: CallRow, state: AccessibleConversationState): boolean {
  if (row.initiatedByType === "AGENT") return actor.type === "CUSTOMER" && actor.id === state.customerId;
  if (actor.type !== "AGENT") return false;
  return isSupervisor(actor.auth) || isOwner(actor.auth, state) || state.assignedAgentId === null;
}

const isCaller = (row: CallRow, p: { participantType: string; participantId: string }) =>
  p.participantType === row.initiatedByType && p.participantId === row.initiatedById;

function toPublic(row: CallRow): Omit<CallDto, "permissions"> {
  return {
    id: idToString(row.id),
    conversationId: idToString(row.conversationId),
    callType: row.callType as CallType,
    status: row.status as CallStatus,
    initiatedBy: { type: row.initiatedByType as PartyType, id: idToString(row.initiatedById) },
    // The caller first, so the order does not depend on row ids.
    participants: [...row.callParticipants]
      .sort((a, b) => Number(isCaller(row, b)) - Number(isCaller(row, a)))
      .map((p) => ({
        type: p.participantType as PartyType,
        id: idToString(p.participantId),
        joinedAt: p.joinedAt === null ? null : p.joinedAt.toISOString(),
        leftAt: p.leftAt === null ? null : p.leftAt.toISOString(),
      })),
    startedAt: row.startedAt === null ? null : row.startedAt.toISOString(),
    endedAt: row.endedAt === null ? null : row.endedAt.toISOString(),
    durationSeconds: row.startedAt && row.endedAt ? seconds(row) : null,
    createdAt: row.createdAt.toISOString(),
  };
}
