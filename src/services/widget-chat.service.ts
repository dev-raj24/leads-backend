// services/widget-chat.service.ts — owner-side view of website chat conversations.

import { query } from "../config/db";

export interface ChatConversation {
  leadId: string;
  name: string | null;
  contact: string;
  status: string;
  messageCount: number;
  lastMessage: string;
  lastMessageAt: string;
  lastFrom: "visitor" | "ai" | "team";
  needsReply: boolean;
  createdAt: string;
}

interface Row {
  id: string;
  name: string | null;
  contact: string;
  status: string;
  created_at: string;
  message_count: string;
  last_body: string;
  last_at: string;
  last_direction: "inbound" | "outbound";
  last_ai: boolean;
}

export async function listConversations(tenantId: string): Promise<ChatConversation[]> {
  const rows = await query<Row>(
    `select l.id, l.name, l.contact, l.status, l.created_at,
            (select count(*) from messages m where m.lead_id = l.id)::text as message_count,
            lm.body as last_body, lm.created_at as last_at,
            lm.direction as last_direction, lm.ai_generated as last_ai
     from leads l
     join lateral (
       select body, created_at, direction, ai_generated
       from messages where lead_id = l.id
       order by created_at desc limit 1
     ) lm on true
     where l.tenant_id = $1 and l.source = 'chat_widget'
     order by lm.created_at desc
     limit 200`,
    [tenantId]
  );
  return rows.map((r) => {
    const lastFrom = r.last_direction === "inbound" ? "visitor" : r.last_ai ? "ai" : "team";
    return {
      leadId: r.id,
      name: r.name,
      contact: r.contact,
      status: r.status,
      messageCount: Number(r.message_count),
      lastMessage: r.last_body,
      lastMessageAt: r.last_at,
      lastFrom,
      needsReply: lastFrom === "visitor",
      createdAt: r.created_at,
    };
  });
}
