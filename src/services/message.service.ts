import { query } from "../config/db";
import type { Message } from "../types";

interface MessageRow {
  id: string;
  lead_id: string;
  channel: string;
  direction: "inbound" | "outbound";
  body: string;
  ai_generated: boolean;
  created_at: string;
}

const toMessage = (row: MessageRow): Message => ({
  id: row.id,
  leadId: row.lead_id,
  channel: row.channel,
  direction: row.direction,
  body: row.body,
  aiGenerated: row.ai_generated,
  createdAt: row.created_at,
});

export async function addMessage(
  leadId: string,
  message: { channel: string; direction: "inbound" | "outbound"; body: string; aiGenerated?: boolean }
): Promise<Message> {
  const rows = await query<MessageRow>(
    `insert into messages (lead_id, channel, direction, body, ai_generated)
     values ($1, $2, $3, $4, $5)
     returning *`,
    [leadId, message.channel, message.direction, message.body, message.aiGenerated ?? false]
  );
  return toMessage(rows[0]);
}

export async function getMessagesForLead(tenantId: string, leadId: string): Promise<Message[]> {
  const rows = await query<MessageRow>(
    `select m.* from messages m
     join leads l on l.id = m.lead_id
     where m.lead_id = $2 and l.tenant_id = $1
     order by m.created_at asc`,
    [tenantId, leadId]
  );
  return rows.map(toMessage);
}

export async function countAiRepliesSince(tenantId: string, since: Date): Promise<number> {
  const rows = await query<{ count: string }>(
    `select count(*)::text as count from messages m
     join leads l on l.id = m.lead_id
     where l.tenant_id = $1 and m.ai_generated = true and m.direction = 'outbound' and m.created_at >= $2`,
    [tenantId, since.toISOString()]
  );
  return Number(rows[0]?.count ?? 0);
}
