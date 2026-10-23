# Database Schema Design — Chat Dashboard

## Overview

This document describes the persistent data model backing the Chat Dashboard
frontend. The schema is defined in `prisma/schema.prisma` and targets
PostgreSQL. It normalizes entities that are currently embedded or duplicated in
the client-side TypeScript DTOs (`ConversationDto`, `ChatMessageDto`,
`ActivityDto` in `src/shared/api/ws/protocol.ts`).

## Entity Relationship Diagram

```
Customer ──<  Application  >── Conversation  >── Message
  │            │                  │  │  │         │
  └──< Conversations            │  │  │         └── Customer (sender)
      └── Messages (customer)   │  │  └── Agent (assigned)
      └── Files                 │  └── AgentConversation (assignments)
                               │  └── Activities
                               └── Files
Agent ──< AgentConversation
  │     └── Messages (agent)
  ├── Activities
  ├── Notifications
  └── Settings
```

## Entities

### 1. Customer

| Column          | Type      | Notes                                    |
|----------------|-----------|------------------------------------------------|
| `id`           | UUID (PK) | Internal primary key                        |
| `name`         | String    | Full name (was `ConversationDto.name`)      |
| `avatar`       | String?   | Avatar URL (was `ConversationDto.avatar`)   |
| `email`        | String?   | Email address                               |
| `phone`        | String?   | Phone number (ApplicationsTable column)     |
| `nationalId`   | String?   | NID (ApplicationsTable column)              |
| `salary`       | String?   | Salary (ApplicationsTable column)           |
| `occupation`   | String?   | Occupation (ApplicationsTable column)       |
| `blacklisted`  | Boolean   | Blacklist flag (ApplicationsTable column)   |
| `createdAt`    | DateTime  |                                            |
| `updatedAt`    | DateTime  |                                            |

**Why normalized**: `ConversationDto` currently stores `name` and `avatar`
directly. These are customer attributes shared with the ApplicationsTable.
A customer with multiple loan applications or conversations should not have
their data duplicated.

### 2. Agent

| Column      | Type      | Notes                          |
|------------|-----------|------------------------------------------------|
| `id`        | UUID (PK) | Internal primary key          |
| `name`      | String    | Full name                     |
| `avatar`    | String?   | Avatar URL                    |
| `email`     | String?   | Unique email                  |
| `active`    | Boolean   | Whether the agent is available|
| `createdAt` | DateTime  |                            |
| `updatedAt` | DateTime  |                            |

**Why added**: Messages with `side: "agent"` reference a specific support
agent. The `conversation.takeover` flow assigns conversations to agents.
Previously, agents were implicit; this table makes them first-class entities.

### 3. Application

| Column         | Type              | Notes                                    |
|---------------|-------------------|------------------------------------------|
| `id`           | UUID (PK)         | Internal primary key                     |
| `appId`        | String (Unique)   | e.g. "61831" (was `Dto.application.appId`)|
| `customerId`   | UUID? (FK)        | Nullable: applications may not have customers yet |
| `reference`    | String (Unique)   | e.g. "LUL-61831-MAYA"                    |
| `product`      | String            | e.g. "Instant Cash"                      |
| `amount`       | String            | e.g. "$500"                              |
| `tenor`        | String            | e.g. "30 days"                           |
| `loanRequest`  | String?           | Loan Request column (ApplicationsTable)  |
| `completeness` | String?           | Completeness column (ApplicationsTable)  |
| `status`       | Enum              | `ApplicationStatus`                       |
| `registeredAt` | DateTime?         | Registered Date column (ApplicationsTable)|
| `createdAt`    | DateTime          |                                           |
| `updatedAt`    | DateTime          |                                           |

**Why normalized**: `ConversationDto.application` is an embedded object with
6 fields. The ApplicationsTable displays additional fields (NID, phone, salary,
occupation, loan request, completeness, registered date) that don't exist on
the DTO. This table unifies both views.

**Enum reconciliation**: The DTO uses string statuses like `"in progress"` and
`"overdue"` (from seed.ts) while `ApplicationsTable.tsx` uses
`"New" | "Reviewing" | "Completed" | "Failed" | "Paid Off"`. The
`ApplicationStatus` enum covers both sets.

### 4. Conversation

| Column             | Type             | Notes                                      |
|--------------------|------------------|--------------------------------------------|
| `id`               | String (PK)      | External slug (e.g. "maya") for WS compat  |
| `customerId`       | UUID? (FK)       | Nullable                                    |
| `applicationId`    | String? (Unique) | 1:1 to Application                          |
| `preview`          | String           | Last message preview                       |
| `lastMessageAt`    | DateTime         | Timestamp of last message                  |
| `unreadCount`      | Int              | Unread message count                       |
| `urgent`           | Boolean          | Priority flag                              |
| `handoff`          | Enum             | `HandoffStatus`: AI, NEEDS_HUMAN, ASSIGNED |
| `assignedAgentId`  | UUID? (FK)       | Currently assigned agent                   |
| `summary`          | String?          | AI-generated summary                       |
| `summaryImage`     | String?          | Summary diagram URL                        |
| `createdAt`        | DateTime         |                                            |
| `updatedAt`        | DateTime         |                                            |

**Key relationships**:
- `customerId` → Customer (the customer in the conversation)
- `applicationId` → Application (the loan this conversation is about)
- `assignedAgentId` → Agent (via `Agent.assignedConversations`)
- `messages` → Message[] (1:M)
- `activities` → Activity[] (1:M, embedded in DTO as array)
- `agentAssignments` → AgentConversation[] (1:M, assignment history)
- `files` → SharedFile[] (1:M)

### 5. Message

| Column             | Type           | Notes                              |
|--------------------|----------------|------------------------------------|
| `id`               | String (PK)    | External ID (e.g. "maya-1", "c-<uuid>") |
| `conversationId`   | String (FK)    | Parent conversation                |
| `senderType`       | Enum           | `MessageSide`: CUSTOMER, ASSISTANT, AGENT |
| `senderCustomerId` | UUID? (FK)     | Populated when `senderType=CUSTOMER`|
| `senderAgentId`    | UUID? (FK)     | Populated when `senderType=AGENT`  |
| `text`             | String         | Message content                    |
| `status`           | Enum?          | `DeliveryStatus`: SENDING, SENT, … |
| `createdAt`        | DateTime       | Timestamp                          |

**Polymorphic sender**: `senderType` determines whether `senderCustomerId` or
`senderAgentId` is populated. For `ASSISTANT` messages (AI), both are NULL.
This avoids a polymorphic FK while still linking individual messages to the
real person who sent them.

### 6. Activity

| Column          | Type       | Notes                              |
|----------------|------------|------------------------------------|
| `id`           | String (PK)| e.g. "a1"                          |
| `conversationId`| String (FK)| Parent conversation               |
| `agentId`      | UUID? (FK) | Nullable — many are system/AI     |
| `tone`         | Enum       | `ActivityTone`: BLUE, CYAN, RED    |
| `title`         | String     | Short label                       |
| `time`          | String     | Display time (e.g. "09:12")       |
| `copy`          | String     | Description text                  |
| `createdAt`     | DateTime   |                                |

**Why normalized**: `ConversationDto.activity` is an embedded array of
`ActivityDto`. As a separate table, activity entries can be paginated, filtered
by tone, and queried independently of conversations.

### 7. AgentConversation (Assignment History)

| Column           | Type       | Notes                             |
|-----------------|------------|-----------------------------------|
| `id`            | UUID (PK)  |                                   |
| `agentId`       | UUID (FK)  | The agent                         |
| `conversationId`| String (FK)| The conversation                  |
| `role`          | Enum       | `AssignmentRole`: OWNER, VIEWER  |
| `assignedAt`    | DateTime   | When assignment began             |
| `unassignedAt`  | DateTime?  | When assignment ended (NULL = active)|

**Why added**: The `conversation.takeover` flow changes a conversation's
`handoff` to `ASSIGNED` and sets `assignedAgentId`, but there's no audit trail.
This table records every assignment, enabling:
- "Who handled this conversation?" queries
- Workload analytics (time-to-response per agent)
- Transfer history

### 8. SharedFile

| Column           | Type      | Notes                                    |
|-----------------|-----------|------------------------------------------|
| `id`            | UUID (PK) |                                          |
| `conversationId`| String(FK)| Links file to its conversation           |
| `customerId`    | UUID(FK)  | Links file to the customer               |
| `applicationId` | UUID?(FK) | Links to the loan application            |
| `name`          | String    | File name                                |
| `kind`          | Enum      | `FileKind`: DOCUMENT, IMAGE              |
| `size`          | String    | Human-readable size (e.g. "1.8 MB")      |
| `url`           | String    | Storage URL for download                 |
| `addedAt`       | String    | Display time (e.g. "Today, 09:06")       |
| `createdAt`     | DateTime  |                                          |

**Why normalized**: `SharedFile` in `share-files/model/store.ts` is a local
Zustand array with no relationship to conversations. This table links shared
files to the conversation, customer, and application, enabling the MediaFilesPanel
to fetch files scoped to a customer or application.

### 9. Setting

| Column     | Type      | Notes                                  |
|-----------|-----------|----------------------------------------|
| `id`      | UUID (PK) |                                        |
| `agentId` | UUID (FK) | Which agent's setting this is          |
| `key`     | String    | e.g. "readReceipts", "aiReplies"       |
| `value`   | Boolean   | On/off                                   |
| `updatedAt`| DateTime |                                     |

**Why added**: Settings from `message-settings` and `privacy-controls` are
currently ephemeral Zustand state. Persisting them allows agent preferences to
survive across sessions and devices.

### 10. Notification

| Column     | Type            | Notes                                  |
|-----------|-----------------|----------------------------------------|
| `id`      | UUID (PK)       |                                        |
| `agentId` | UUID (FK)       | Recipient agent                        |
| `type`    | Enum            | `NotificationType`                     |
| `text`    | String          | Notification message                   |
| `read`    | Boolean         | Whether the agent has seen it          |
| `createdAt`| DateTime       | Chronological ordering                 |

**Why added**: The Notifications feature (`features/notifications/`) is a
placeholder. This table backs it with persisted, filterable notifications.

## Mapping: Database → WebSocket DTOs

The server composes DTOs from the normalized tables when sending `sync` and
`conversation.updated` events. A materialized view (`conversation_dto`) is
documented in the Prisma schema as SQL for reference.

| DTO field                                        | Source table        |
|--------------------------------------------------|---------------------|
| `ConversationDto.id`                             | Conversation.id     |
| `ConversationDto.name`                           | Customer.name       |
| `ConversationDto.avatar`                         | Customer.avatar     |
| `ConversationDto.preview`                        | Conversation.preview  |
| `ConversationDto.lastMessageAt`                  | Conversation.lastMessageAt |
| `ConversationDto.unread`                         | Conversation.unreadCount |
| `ConversationDto.urgent`                         | Conversation.urgent |
| `ConversationDto.handoff`                        | Conversation.handoff |
| `ConversationDto.application.*`                  | Application.*       |
| `ConversationDto.activity[]`                     | Activity[]          |
| `ConversationDto.summary`                        | Conversation.summary |
| `ConversationDto.summaryImage`                   | Conversation.summaryImage |
| `ChatMessageDto.*`                               | Message.*           |
| `ActivityDto.*`                                  | Activity.*          |

## Indexes

Key indexes for query performance:

- `Conversation(handoff, unreadCount)` — dashboard filtering (unassigned / urgent)
- `Conversation(lastMessageAt)` — conversation list ordering
- `Message(conversationId, createdAt)` — message list pagination
- `Message(conversationId, status)` — delivery status tracking
- `Activity(conversationId, createdAt)` — activity timeline
- `AgentConversation(conversationId, assignedAt)` — assignment history
- `Notification(agentId, read)` — notification inbox
- `Notification(createdAt)` — chronological notification ordering
- `Customer(phone)`, `Customer(blacklisted)` — lookup by phone, blacklist checks

## WebSocket Protocol Compatibility

The schema preserves external string IDs used by the WebSocket protocol:
- Conversation IDs like `"maya"`, `"gyna"` are used directly as `Conversation.id`
- Message IDs like `"maya-1"` or `"c-<uuid>"` are used directly as `Message.id`
- Activity IDs like `"a1"` are used directly as `Activity.id`

This avoids a migration of existing WebSocket message references from the
client side.
