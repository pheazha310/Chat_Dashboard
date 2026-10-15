import { assets } from "@/shared/config/assets";
import type { ChatMessageDto, ConversationDto } from "../protocol";

/** ISO timestamp for `hh:mm` today (dayOffset 0) or on an earlier day. */
const at = (time: string, dayOffset = 0) => {
  const [hours, minutes] = time.split(":").map(Number);
  const date = new Date();
  date.setDate(date.getDate() - dayOffset);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
};

const application = (appId: string, reference: string, status = "in progress") => ({
  appId,
  product: "Instant Cash",
  amount: "$500",
  tenor: "30 days",
  status,
  reference,
});

export function seedConversations(): ConversationDto[] {
  return [
    {
      id: "maya",
      name: "Maya Chen",
      avatar: assets.users.mayaList,
      preview: "CM repayment schedule needs review",
      lastMessageAt: at("09:12"),
      unread: 2,
      urgent: true,
      handoff: "needs-human",
      application: application("61831", "LUL-61831-MAYA"),
      summary:
        "Maya requested moving her repayment date to the 25th. Assigned to Customer Management; awaiting approval.",
      summaryImage: assets.icons.summary,
      activity: [
        {
          id: "a1",
          tone: "blue",
          title: "Repayment date request received",
          time: "09:08",
          copy: "Customer asked to move the repayment date from the 30th to the 25th.",
        },
        {
          id: "a2",
          tone: "cyan",
          title: "AI handoff created",
          time: "09:10",
          copy: "AI confirmed it cannot update repayment schedules and opened a human review task.",
        },
        {
          id: "a3",
          tone: "red",
          title: "Task assigned to CM",
          time: "09:12",
          copy: "Maya Chen is now waiting for a customer management response on repayment schedule approval.",
        },
      ],
    },
    {
      id: "gyna",
      name: "Gyna Catherine",
      avatar: assets.users.gyna,
      preview: "Can I upload a bank statement?",
      lastMessageAt: at("09:18"),
      unread: 1,
      urgent: false,
      handoff: "ai",
      application: application("61832", "LUL-61832-GYNA"),
      summary: "Gyna asked whether she can upload a bank statement.",
      activity: [],
    },
    {
      id: "nayla",
      name: "Nayla Sari",
      avatar: assets.users.nayla,
      preview: "Human agent requested",
      lastMessageAt: at("09:24"),
      unread: 0,
      urgent: true,
      handoff: "needs-human",
      application: application("61833", "LUL-61833-NAYLA"),
      summary: "Nayla asked to speak with a human agent.",
      activity: [],
    },
    {
      id: "raditya",
      name: "Raditya Rasyid",
      avatar: assets.users.raditya,
      preview: "Sent voice note about repayment",
      lastMessageAt: at("09:29"),
      unread: 3,
      urgent: false,
      handoff: "ai",
      application: application("61834", "LUL-61834-RAD"),
      summary: "Raditya sent a voice note about his repayment.",
      activity: [],
    },
    {
      id: "arlene",
      name: "Arlene Lily",
      avatar: assets.users.arlene,
      preview: "Wants to change repayment date",
      lastMessageAt: at("09:31"),
      unread: 2,
      urgent: false,
      handoff: "ai",
      application: application("61835", "LUL-61835-ARL"),
      summary: "Arlene wants to change her repayment date.",
      activity: [],
    },
    {
      id: "jacob",
      name: "Jacob Jones",
      avatar: assets.users.jacob,
      preview: "Missed callback on overdue case",
      lastMessageAt: at("16:20", 1),
      unread: 0,
      urgent: true,
      handoff: "needs-human",
      application: application("61836", "LUL-61836-JAC", "overdue"),
      summary: "Jacob missed a callback on an overdue case.",
      activity: [],
    },
    ...["ananda-1", "ananda-2", "ananda-3", "ananda-4"].map((id, index): ConversationDto => ({
      id,
      name: "Ananda Alodea",
      avatar: assets.users.ananda,
      preview: "Asked about disbursement timing",
      lastMessageAt: at(`1${index}:05`, 1),
      unread: 1,
      urgent: false,
      handoff: "ai",
      application: application(`6184${index}`, `LUL-6184${index}-ANA`),
      summary: "Ananda asked about disbursement timing.",
      activity: [],
    })),
  ];
}

export function seedMessages(conversations: ConversationDto[]): Record<string, ChatMessageDto[]> {
  const messages: Record<string, ChatMessageDto[]> = {
    maya: [
      {
        id: "maya-1",
        conversationId: "maya",
        side: "customer",
        status: "sent",
        createdAt: at("09:08"),
        text: "Hi, I submitted my instant cash application yesterday. Can I change my repayment date to the 25th instead of the 30th?",
      },
      {
        id: "maya-2",
        conversationId: "maya",
        side: "assistant",
        createdAt: at("09:09"),
        text: "Welcome to LUYLEUN Mobile App. Kindly stay on the line while we connect you to our agent.",
      },
      {
        id: "maya-3",
        conversationId: "maya",
        side: "customer",
        status: "read",
        createdAt: at("09:10"),
        text: "Okay, please connect me with someone who can update the date today.",
      },
      {
        id: "maya-4",
        conversationId: "maya",
        side: "agent",
        createdAt: at("09:12"),
        text: "Hi! You're chatting with a member of our team. Your application is still being reviewed, and your repayment date is set for the 30th. I've asked our customer management team to confirm the next steps for you.",
      },
    ],
  };
  for (const conversation of conversations) {
    messages[conversation.id] ??= [
      {
        id: `${conversation.id}-1`,
        conversationId: conversation.id,
        side: "customer",
        status: "sent",
        createdAt: conversation.lastMessageAt,
        text: conversation.preview,
      },
    ];
  }
  return messages;
}
